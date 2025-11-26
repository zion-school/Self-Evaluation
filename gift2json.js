#!/usr/bin/env node

/*
 *  moodle/public/question/format/gift/format.php - f747c15
 *
 *  URL : https://github.com/moodle/moodle/blob/main/public/question/format/gift/format.php
 * 
 *  Translated PHP code to JS using ChatGPT
 *  
 *  Co-author    : Jabez Winston C
 *  Organization : Zion Nursery & Primary School, Kovaipudur
 *  
 *  Date : 06-Sep-2025
 */

/**
 * GIFT format parser & exporter (Node.js, no TS)
 *
 * - Parses Moodle GIFT text into JSON question objects
 * - Exports JSON question objects back into GIFT
 * - Includes a small CLI
 *
 * Supported qtypes: category (pseudo), description, essay, multichoice,
 * match, truefalse, shortanswer, numerical
 *
 * Notes:
 * - Implements escaping compatible with Moodle's gift rules for \: \# \= \{ \} \~ \n
 * - Supports optional name (::name::), general feedback (####...),
 *   answer-level feedback (#...), weights (%n.n%), idnumber [id:..] and tags [tag:..]
 */

/* =============================
 * Utilities
 * ============================= */
const FORMAT = {
  MOODLE: 'moodle',
  HTML: 'html',
  PLAIN: 'plain',
  MARKDOWN: 'markdown',
};

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function formatNameToConst(name) {
  if (!name) return FORMAT.MOODLE;
  const n = String(name).toLowerCase();
  if (n === 'moodle') return FORMAT.MOODLE;
  if (n === 'html') return FORMAT.HTML;
  if (n === 'plain') return FORMAT.PLAIN;
  if (n === 'markdown') return FORMAT.MARKDOWN;
  return FORMAT.MOODLE; // default
}

function formatConstToName(fmt) {
  switch (fmt) {
    case FORMAT.HTML: return 'html';
    case FORMAT.PLAIN: return 'plain';
    case FORMAT.MARKDOWN: return 'markdown';
    case FORMAT.MOODLE:
    default: return 'moodle';
  }
}

function defaultQuestion() {
  return {
    id: undefined,
    name: '',
    qtype: '',
    questiontext: '',
    questiontextformat: FORMAT.MOODLE,
    generalfeedback: '',
    generalfeedbackformat: FORMAT.MOODLE,
    idnumber: '',
    tags: [],
  };
}

// Placeholder-based escape handling (compatible with Moodle logic)
const ESC_PRE = {
  '\\:': '&&058;',
  '\\#': '&&035;',
  '\\=': '&&061;',
  '\\{': '&&123;',
  '\\}': '&&125;',
  '\\~': '&&126;',
  '\\n': '&&010',
};
const ESC_POST = Object.fromEntries(Object.entries(ESC_PRE).map(([k,v]) => [v, k.slice(1)]));

function escapedcharPre(str) {
  if (!str) return str;
  // temporarily mask \\ so it doesn't get double processed
  str = str.replace(/\\\\/g, '&&092;');
  for (const [from, to] of Object.entries(ESC_PRE)) {
    str = str.replace(new RegExp(escapeRegExp(from), 'g'), to);
  }
  // restore single backslash
  str = str.replace(/&&092;/g, '\\');
  return str;
}

function escapedcharPost(str) {
  if (!str) return str;
  for (const [from, to] of Object.entries(ESC_POST)) {
    str = str.replace(new RegExp(escapeRegExp(from), 'g'), to);
  }
  return str;
}

function repchar(text) {
  // Escape reserved characters when exporting
  if (text == null) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .replace(/=/g, '\\=')
    .replace(/~/g, '\\~')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/:/g, '\\:')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function parseTextWithFormat(text, defaultFormat = FORMAT.MOODLE) {
  const result = { text: '', format: defaultFormat };
  if (!text) return result;
  text = String(text);
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close > 0) {
      const fmt = text.slice(1, close);
      const fmtConst = formatNameToConst(fmt);
      if (fmtConst) {
        result.format = fmtConst;
        result.text = text.slice(close + 1);
      }
    }
  }
  if (!result.text) result.text = text;
  result.text = escapedcharPost(result.text.trim());
  return result;
}

function writeQuestionText(text, format, defaultFormat = FORMAT.MOODLE) {
  let out = '';
  if (text && format && format !== defaultFormat) {
    out += `[${formatConstToName(format)}]`;
  }
  out += repchar(text || '');
  return out;
}

function writeName(name){
  return `::${repchar(name || '')}::`;
}

function splitTrueFalseComment(answer, defaultFormat){
  const bits = answer.split('#', 3);
  const ans = parseTextWithFormat(bits[0].trim(), defaultFormat);
  const wrong = bits.length > 1 ? parseTextWithFormat(bits[1].trim(), defaultFormat)
                                : { text: '', format: defaultFormat };
  const right = bits.length > 2 ? parseTextWithFormat(bits[2].trim(), defaultFormat)
                                : { text: '', format: defaultFormat };
  return [ans, wrong, right];
}

function commentParser(answer, defaultFormat){
  const bits = answer.split('#', 2);
  const ans = parseTextWithFormat(bits[0].trim(), defaultFormat);
  const feedback = bits.length > 1 ? parseTextWithFormat(bits[1].trim(), defaultFormat)
                                   : { text: '', format: defaultFormat };
  return [ans, feedback];
}

function parseWeight(answerStr){
  // expects leading %n.n%
  const m = answerStr.match(/^%\-?([0-9]{1,2})(?:\.([0-9]*))?%/);
  if (!m) return { weight: null, rest: answerStr };
  const num = parseFloat(`${m[1]}${m[2] ? '.'+m[2] : ''}`);
  const weight = num/100;
  return { weight, rest: answerStr.slice(m[0].length) };
}

function extractIdnumberAndTags(commentBlock){
  let idnumber = '';
  // Match PHP pattern: \[id:((?:\\]|[^][:cntrl:]])+)]
  const idMatch = commentBlock.match(/\[id:((?:\\\]|[^\]\x00-\x1F\x7F])+)\]/);
  if (idMatch) idnumber = idMatch[1].replace(/\\\]/g, ']').trim();

  const tags = [];
  // Match PHP pattern: \[tag:((?:\\]|[^]<>`[:cntrl:]]|)+)]
  const tagRe = /\[tag:((?:\\\]|[^\]<>`\x00-\x1F\x7F])+)\]/g;
  let tm;
  while ((tm = tagRe.exec(commentBlock))) {
    tags.push(tm[1].replace(/\\\]/g, ']').trim());
  }
  return { idnumber, tags };
}

/* =============================
 * Parser
 * ============================= */
function parseGift(input){
  const lines = String(input).replace(/\r\n?/g,'\n').split('\n');
  const questions = [];
  let buf = [];

  function flush(){
    const q = parseQuestion(buf);
    buf = [];
    if (q) questions.push(q);
  }

  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (/^\s*$/.test(line)) { // blank line separates questions
      if (buf.length) flush();
    } else {
      buf.push(line);
    }
  }
  if (buf.length) flush();

  return questions;
}

function parseQuestion(lines){
  const q = defaultQuestion();
  const giftAnswerWeightRegex = /^%\-?([0-9]{1,2})(?:\.([0-9]+))?%/;

  // separate // comments
  let comments = '';
  const work = lines.map((ln)=>{
    const s = ln.trim();
    if (s.startsWith('//')) { comments += s + '\n'; return ' '; }
    return ln;
  });
  let text = work.join('\n').trim();
  if (!text) return null;

  // pre-escape
  text = escapedcharPre(text);

  // $CATEGORY
  if (/^\$CATEGORY:\s*/.test(text)){
    q.qtype = 'category';
    q.category = text.replace(/^\$CATEGORY:\s*/, '').trim();
    return q;
  }

  // ::name::
  if (text.startsWith('::')){
    const pos = text.indexOf('::', 2);
    if (pos !== -1){
      const nm = text.slice(2, pos);
      q.name = nm ? escapedcharPost(nm) : '';
      text = text.slice(pos+2).trim();
    }
  }

  const answerStart = text.indexOf('{');
  const answerFinish = text.lastIndexOf('}');

  let description = false;
  let answertext = '';
  let answerlength = 0;
  if (answerStart === -1 && answerFinish === -1){
    description = true;
  } else if (answerStart === -1 || answerFinish === -1 || answerFinish < answerStart){
    throw new Error('Brace error in question: ' + escapedcharPost(text));
  } else {
    answerlength = answerFinish - answerStart;
    answertext = text.slice(answerStart+1, answerFinish).trim();
  }

  let questiontext;
  if (description){
    questiontext = text;
  } else if (/\}\s*$/.test(text)){
    questiontext = text.slice(0, answerStart) + text.slice(answerFinish+1);
  } else {
    questiontext = text.slice(0, answerStart) + '_____' + text.slice(answerFinish+1);
  }

  // general feedback
  let generalfeedback = '';
  const gfidx = answertext.lastIndexOf('####');
  if (gfidx !== -1){
    generalfeedback = answertext.slice(gfidx + 4);
    answertext = answertext.slice(0, gfidx).trim();
  }

  const qtParsed = parseTextWithFormat(questiontext);
  q.questiontext = qtParsed.text;
  q.questiontextformat = qtParsed.format;

  const gfParsed = parseTextWithFormat(generalfeedback, q.questiontextformat);
  q.generalfeedback = gfParsed.text;
  q.generalfeedbackformat = gfParsed.format;

  if (!q.name) {
    q.name = q.questiontext.replace(/<[^>]*>/g,'').slice(0, 30) || 'Question';
  }

  // idnumber & tags from comments
  const meta = extractIdnumberAndTags(comments);
  q.idnumber = meta.idnumber;
  q.tags = meta.tags;

  // Determine qtype
  if (description){
    q.qtype = 'description';
    q.defaultmark = 0; q.length = 0;
    return q;
  }
  if (answertext === ''){
    q.qtype = 'essay';
    q.responseformat = 'editor';
    q.responserequired = 1; q.responsefieldlines = 15; q.attachments = 0; q.attachmentsrequired = 0;
    q.graderinfo = { text: '', format: FORMAT.HTML };
    q.responsetemplate = { text: '', format: FORMAT.HTML };
    return q;
  }
  if (answertext[0] === '#'){
    q.qtype = 'numerical';
  } else if (answertext.includes('~')){
    q.qtype = 'multichoice';
  } else if (answertext.includes('=') && answertext.includes('->')){
    q.qtype = 'match';
  } else {
    const tfcheck = (answertext.includes('#') ? answertext.split('#',1)[0] : answertext).trim().toUpperCase();
    if (['T','TRUE','F','FALSE'].includes(tfcheck)) q.qtype = 'truefalse';
    else q.qtype = 'shortanswer';
  }

  switch(q.qtype){
    case 'multichoice': {
      // default single if any '=' present, otherwise multi
      q.answernumbering = 'abc';
      q.single = answertext.includes('=') ? 1 : 0;
      q.answers = [];
      const normalized = answertext.replace(/=/g, '~=');
      const parts = normalized.split('~').map(s=>s.trim()).filter(Boolean);
      if (parts.length < 2) throw new Error('Multiple choice requires at least 2 answers');
      for (const part of parts){
        let weight = 0;
        let rest = part;
        if (rest.startsWith('=')) { weight = 1; rest = rest.slice(1); }
        else { const pw = parseWeight(rest); if (pw.weight!=null){ weight = pw.weight; rest = pw.rest; } }
        const [ans, feedback] = commentParser(rest, q.questiontextformat);
        q.answers.push({ answer: ans.text, answerformat: ans.format, fraction: weight, feedback: feedback.text, feedbackformat: feedback.format });
      }
      return q;
    }
    case 'match': {
      q.subquestions = [];
      const parts = answertext.split('=').map(s=>s.trim()).filter(Boolean);
      if (parts.length < 2) throw new Error('Matching requires at least 2 pairs');
      for (const p of parts){
        const marker = p.indexOf('->');
        if (marker === -1) throw new Error('Matching pair must contain ->');
        const left = p.slice(0, marker);
        const right = p.slice(marker+2).trim();
        const leftParsed = parseTextWithFormat(left, q.questiontextformat);
        q.subquestions.push({ questiontext: leftParsed.text, questiontextformat: leftParsed.format, answertext: escapedcharPost(right) });
      }
      return q;
    }
    case 'truefalse': {
      const [ans, wrongfb, rightfb] = splitTrueFalseComment(answertext, q.questiontextformat);
      const isTrue = ['T','TRUE'].includes(ans.text.toUpperCase());
      q.correctanswer = isTrue ? 1 : 0;
      q.feedbacktrue = isTrue ? rightfb : wrongfb;
      q.feedbackfalse = isTrue ? wrongfb : rightfb;
      q.penalty = 1;
      return q;
    }
    case 'shortanswer': {
      q.answers = [];
      const parts = answertext.split('=').map(s=>s.trim()).filter(Boolean);
      if (!parts.length) throw new Error('Shortanswer requires at least 1 answer');
      for (const p of parts){
        let weight = 1; let rest = p;
        const pw = parseWeight(rest);
        if (pw.weight!=null){ weight = pw.weight; rest = pw.rest; }
        const [ans, fb] = commentParser(rest, q.questiontextformat);
        q.answers.push({ answer: ans.text, fraction: weight, feedback: fb.text, feedbackformat: fb.format });
      }
      return q;
    }
    case 'numerical': {
      q.answers = [];
      let body = answertext.slice(1); // remove leading '#'
      let wrongfeedback = '';
      const tpos = body.indexOf('~');
      if (tpos !== -1){
        wrongfeedback = body.slice(tpos);
        body = body.slice(0, tpos);
      }
      const parts = body.split('=').map(s=>s.trim()).filter(Boolean);
      if (!parts.length) throw new Error('Numerical requires answers');
      for (const p of parts){
        let weight = 1; let rest = p;
        const pw = parseWeight(rest);
        if (pw.weight!=null){ weight = pw.weight; rest = pw.rest; }
        const [ansParsed, fb] = commentParser(rest, q.questiontextformat);
        const raw = ansParsed.text;
        let ans, tol;
        if (raw.includes('..')){
          const [min,max] = raw.split('..').map(s=>parseFloat(s.trim()));
          if (!isFinite(min) || !isFinite(max)) throw new Error('Numerical range must be numbers');
          ans = (max+min)/2; tol = max - ans;
        } else if (raw.includes(':')){
          const idx = raw.indexOf(':');
          ans = parseFloat(raw.slice(0, idx).trim());
          tol = parseFloat(raw.slice(idx+1).trim());
          if (!isFinite(ans) || !isFinite(tol)) throw new Error('Numerical answer and tolerance must be numbers');
        } else {
          ans = parseFloat(raw.trim()); tol = 0;
          if (!(isFinite(ans) || raw.trim() === '*')) throw new Error('Numerical answer must be a number');
        }
        q.answers.push({ answer: ans, tolerance: tol, fraction: weight, feedback: fb.text, feedbackformat: fb.format });
      }
      if (wrongfeedback){
        const [, fb] = commentParser(wrongfeedback, q.questiontextformat);
        q.answers.push({ answer: '*', tolerance: '', fraction: 0, feedback: fb.text, feedbackformat: fb.format });
      }
      return q;
    }
    default:
      throw new Error('Unhandled qtype');
  }
}

/* =============================
 * Exporter
 * ============================= */
function exportGift(questions){
  const out = [];
  for (const q of questions){
    out.push(writeOne(q));
  }
  return out.join('\n');
}

function writeIdnumberAndTags(q){
  if (q.qtype === 'category') return '';
  const bits = [];
  if (q.idnumber) bits.push('[id:' + String(q.idnumber).replace(/\]/g,'\\]') + ']');
  if (Array.isArray(q.tags)){
    for (const t of q.tags) bits.push('[tag:' + String(t).replace(/\]/g,'\\]') + ']');
  }
  return bits.length ? '// ' + bits.join(' ') + '\n' : '';
}

function writeGeneralFeedback(q, indent='\t'){
  const gf = writeQuestionText(q.generalfeedback, q.generalfeedbackformat, q.questiontextformat);
  if (!gf) return '';
  const line = '####' + gf;
  return indent ? indent + line + '\n' : line;
}

function writeOne(question){
  const q = clone(question);
  let exp = `// question: ${q.id ?? ''}  name: ${q.name ?? ''}\n`;
  exp += writeIdnumberAndTags(q);

  switch(q.qtype){
    case 'category':
      exp += `$CATEGORY: ${q.category}\n`;
      break;
    case 'description':
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      break;
    case 'essay':
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{';
      exp += writeGeneralFeedback(q, '');
      exp += '}\n';
      break;
    case 'truefalse': {
      // Expect shape similar to parsed structure
      const isTrue = q.correctanswer ? 1 : 0;
      const rightfb = isTrue ? q.feedbacktrue : q.feedbackfalse;
      const wrongfb = isTrue ? q.feedbackfalse : q.feedbacktrue;
      const right = writeQuestionText(rightfb?.text || '', rightfb?.format || q.questiontextformat, q.questiontextformat);
      const wrong = writeQuestionText(wrongfb?.text || '', wrongfb?.format || q.questiontextformat, q.questiontextformat);
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{' + repchar(isTrue ? 'TRUE' : 'FALSE');
      if (wrong) exp += '#' + wrong; else if (right) exp += '#';
      if (right) exp += '#' + right;
      exp += writeGeneralFeedback(q, '');
      exp += '}\n';
      break; }
    case 'multichoice': {
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{\n';
      for (const ans of (q.answers||[])){
        let lead;
        if (ans.fraction === 1 && (q.single===1 || q.single===true)) lead = '=';
        else if (!ans.fraction) lead = '~';
        else lead = `~%${ans.fraction*100}%`;
        const ansText = writeQuestionText(ans.answer, ans.answerformat||q.questiontextformat, q.questiontextformat);
        exp += `\t${lead}${ansText}`;
        if (ans.feedback) {
          const fb = writeQuestionText(ans.feedback, ans.feedbackformat||q.questiontextformat, q.questiontextformat);
          exp += `#${fb}`;
        }
        exp += '\n';
      }
      exp += writeGeneralFeedback(q);
      exp += '}\n';
      break; }
    case 'shortanswer': {
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{\n';
      for (const ans of (q.answers||[])){
        const weight = (ans.fraction ?? 1) * 100;
        const fb = writeQuestionText(ans.feedback||'', ans.feedbackformat||q.questiontextformat, q.questiontextformat);
        exp += `\t=%${weight}%${repchar(ans.answer)}#${fb}\n`;
      }
      exp += writeGeneralFeedback(q);
      exp += '}\n';
      break; }
    case 'numerical': {
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{#\n';
      for (const ans of (q.answers||[])){
        if (ans.answer !== '*' && ans.answer !== ''){
          const weight = (ans.fraction ?? 1) * 100;
          const fb = writeQuestionText(ans.feedback||'', ans.feedbackformat||q.questiontextformat, q.questiontextformat);
          exp += `\t=%${weight}%${ans.answer}:${Number(ans.tolerance)}#${fb}\n`;
        } else {
          const fb = writeQuestionText(ans.feedback||'', ans.feedbackformat||q.questiontextformat, q.questiontextformat);
          exp += `\t~#${fb}\n`;
        }
      }
      exp += writeGeneralFeedback(q);
      exp += '}\n';
      break; }
    case 'match': {
      exp += writeName(q.name);
      exp += writeQuestionText(q.questiontext, q.questiontextformat);
      exp += '{\n';
      for (const sq of (q.subquestions||[])){
        const left = writeQuestionText(sq.questiontext, sq.questiontextformat||q.questiontextformat, q.questiontextformat);
        exp += `\t=${left} -> ${repchar(sq.answertext)}\n`;
      }
      exp += writeGeneralFeedback(q);
      exp += '}\n';
      break; }
    default:
      throw new Error('Unsupported qtype in exporter: ' + q.qtype);
  }

  exp += '\n';
  return exp;
}

/* =============================
 * CLI
 * ============================= */
if (require.main === module){
  const fs = require('fs');
  const path = require('path');

  const args = process.argv.slice(2);
  const usage = () => {
    console.error(`\nGIFT Parser/Exporter\n\nUsage:\n  gift-parser-exporter.js parse <input.txt> [output.json]\n  gift-parser-exporter.js export <input.json> [output.txt]\n\nExamples:\n  ./gift-parser-exporter.js parse questions.txt questions.json\n  ./gift-parser-exporter.js export questions.json questions.txt\n`);
    process.exit(1);
  };

  if (args.length < 2) usage();
  const cmd = args[0];
  const infile = args[1];
  const outfile = args[2];

  try {
    if (cmd === 'parse'){
      const text = fs.readFileSync(infile, 'utf8');
      const result = parseGift(text);
      const json = JSON.stringify(result, null, 2);
      if (outfile) fs.writeFileSync(outfile, json);
      else process.stdout.write(json + '\n');
    } else if (cmd === 'export'){
      const data = JSON.parse(fs.readFileSync(infile, 'utf8'));
      const txt = exportGift(data);
      if (outfile) fs.writeFileSync(outfile, txt);
      else process.stdout.write(txt);
    } else usage();
  } catch (e){
    console.error('Error:', e.message);
    process.exit(2);
  }
}

/* =============================
 * Exports for library use
 * ============================= */
module.exports = {
  parseGift,
  exportGift,
  // Expose helpers for testing/advanced use
  _internal: {
    escapedcharPre,
    escapedcharPost,
    parseTextWithFormat,
    repchar,
    splitTrueFalseComment,
    commentParser,
    extractIdnumberAndTags,
    FORMAT,
  }
};
