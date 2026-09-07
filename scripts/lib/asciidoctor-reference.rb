# The reference renderer: Asciidoctor's own Ruby, driven from the
# TypeScript harnesses.
#
# Two programs claim to be Asciidoctor here. The Ruby gem is the
# REFERENCE, the program whose source the registries cite. The
# `@asciidoctor/core` build the tests render through is a rewrite of
# it, not a transpile of it, so "the tables cite the Ruby" and "the
# harness renders through the JavaScript" are two different claims and
# nothing measured them against each other until the scripts that call
# this file did. This file is the Ruby half of those measurements, and
# it is deliberately dumb: it renders cases somebody else generated
# and writes what came back, so no transcription sits between the two
# programs.
#
# Modes, all of them file in and file out (stdout stays free for
# diagnostics):
#
#   version                        prints the gem's version
#   render  <cases.json> <out>     one JSONL line per case: raw HTML
#   lens    <cases.json> <out>     one JSONL line per case: folded HTML
#   fold    <html.json> <out>      folds an array of HTML strings
#
# A case is {"id", "src", "attrs"}; `attrs` supplies attributes the
# document itself does not set, which is the one thing the JavaScript
# side cannot do through the harness lens.
#
# Exit codes match scripts/lib/cli.ts: 0 it ran, 2 it could not (the
# gem is not installed, or the arguments are wrong). There is no exit
# 1 here because this file decides nothing.
require 'json'

CANNOT_RUN = 2

# Homebrew installs the gem under its own prefix with no default load
# path entry, so a plain require finds nothing on a machine where
# `asciidoctor --version` works. Look where that install puts it
# before giving up, and let an operator name a path we did not guess.
def load_asciidoctor
  require 'asciidoctor'
rescue LoadError
  candidates = ENV.fetch('ASCIIDOCTOR_LIB', '').split(File::PATH_SEPARATOR)
  candidates += Dir.glob('/opt/homebrew/opt/asciidoctor/libexec/gems/asciidoctor-*/lib')
  candidates += Dir.glob('/usr/local/opt/asciidoctor/libexec/gems/asciidoctor-*/lib')
  found = candidates.find { |dir| File.exist?(File.join(dir, 'asciidoctor.rb')) }
  if found.nil?
    warn 'asciidoctor (Ruby gem) not found; set ASCIIDOCTOR_LIB to its lib directory'
    exit CANNOT_RUN
  end
  $LOAD_PATH.unshift found
  require 'asciidoctor'
end

NUL = 0.chr

# tests/helpers.ts decodes a numeric reference that names one of the
# three markup characters to the NAMED spelling, so that decoding can
# never turn text into something that reads as a tag.
MARKUP_CHARACTER_NAMES = { '&' => '&amp;', '<' => '&lt;', '>' => '&gt;' }.freeze

# The port of decodeNumericReferences in tests/helpers.ts. A code point
# outside the Unicode range names nothing and is left as it stands; so
# is NUL, which is the byte the region sentinel is built from, and so
# is a SURROGATE: half a pair is not a character. The surrogate arm is
# the one place the two decoders could not agree by accident. Ruby's
# pack('U') builds a string the next match raises on
# (ArgumentError: invalid byte sequence in UTF-8), which would abort a
# whole population's render rather than spoil one row, while
# JavaScript's String.fromCodePoint hands back a lone surrogate. Both
# now leave the reference alone.
def decode_numeric_references(html)
  html.gsub(/&#(?:[xX][0-9a-fA-F]+|[0-9]+);/) do |match|
    body = match[2..-2]
    code_point = body.start_with?('x', 'X') ? body[1..].to_i(16) : body.to_i(10)
    if code_point > 0 && code_point <= 0x10FFFF &&
       !(code_point >= 0xD800 && code_point <= 0xDFFF)
      character = [code_point].pack('U')
      MARKUP_CHARACTER_NAMES[character] || character
    else
      match
    end
  end
end

# The port of the fold half of renderedHtml in tests/helpers.ts:
# stash <pre>, fold line breaks, stash <code>, decode references, fold
# runs, restore. The order is the reason a run inside a code span is
# visible while a line break inside one is not, and the sentinel is
# NUL-delimited exactly as in the TypeScript: a sentinel with spaces
# around it would be eaten by the run fold, and its restore would
# consume a neighbouring space, which is a different lens.
#
# The equality of this port with the TypeScript one is not a claim
# made in prose. tests/scripts/whitespace-battery.test.ts applies both
# to the committed samples and compares the bytes.
def fold(html)
  kept = []
  stash = lambda do |text, region|
    text.gsub(region) do |match|
      kept << match
      "#{NUL}R#{kept.size - 1}#{NUL}"
    end
  end
  folded = stash.call(html, %r{<pre[^>]*>[\s\S]*?</pre>}m)
  folded = folded.gsub(/[ \t]*\n[ \t]*/, ' ')
  folded = stash.call(folded, %r{<code[^>]*>[\s\S]*?</code>}m)
  folded = decode_numeric_references(folded)
  folded = folded.gsub(/[ \t]{2,}|\t/, ' ')
  # A sentinel naming no stashed region is left as it stands, which
  # is what the TypeScript fold does too: no render emits NUL, so the
  # case arrives only from text that forged one, and replacing it
  # with nothing would silently shorten a compared render.
  folded.gsub(/#{Regexp.escape(NUL)}R(\d+)#{Regexp.escape(NUL)}/) do |sentinel|
    kept[Regexp.last_match(1).to_i] || sentinel
  end
end

# A fold that raised would take the whole population with it: the
# process writes one file at the end, so an exception loses every row
# rather than the row that caused it. A fold failure is therefore a
# RESULT, compared like any other output, and a document that folds on
# one side and not the other shows up as a difference.
def fold_or_error(html)
  fold(html)
rescue StandardError => e
  "FOLD_ERROR: #{e.class}: #{e.message}"
end

# A render failure is a result, not a crash: a battery that stops on
# the first document the reference refuses measures nothing about the
# rest of the population. The marker is compared like any other
# output, so a case that fails on one side and not the other shows up
# as a difference rather than as silence.
def convert(source, attributes)
  options = { safe: :safe, standalone: false }
  options[:attributes] = attributes unless attributes.nil? || attributes.empty?
  Asciidoctor.convert(source, **options)
rescue StandardError => e
  "RENDER_ERROR: #{e.class}: #{e.message}"
end

def each_case(path)
  JSON.parse(File.read(path)).each do |kase|
    yield kase['id'], convert(kase['src'], kase['attrs'])
  end
end

def run(mode, input_path, output_path)
  case mode
  when 'render'
    File.open(output_path, 'w') do |out|
      each_case(input_path) { |id, html| out.puts JSON.generate({ 'id' => id, 'html' => html }) }
    end
  when 'lens'
    File.open(output_path, 'w') do |out|
      each_case(input_path) { |id, html| out.puts JSON.generate({ 'id' => id, 'lens' => fold_or_error(html) }) }
    end
  when 'fold'
    samples = JSON.parse(File.read(input_path))
    File.write(output_path, JSON.generate(samples.map { |sample| fold(sample) }))
  end
end

mode = ARGV[0]
if mode == 'version'
  load_asciidoctor
  puts Asciidoctor::VERSION
  exit 0
end

unless %w[render lens fold].include?(mode) && ARGV.length == 3
  warn 'usage: asciidoctor-reference.rb version | (render|lens|fold) <input.json> <output>'
  exit CANNOT_RUN
end

load_asciidoctor
run(mode, ARGV[1], ARGV[2])
