// IRUSHY local engine - intent classification (Tamil + English).
//
// An ordered list of rules. The first rule that fires decides the intent; its
// fixed confidence and rule name are returned so the debug field can show
// exactly why an answer was given. Cue phrases use the matcher in lang.js:
// English words are stemmed, Tamil words match by stem prefix, a trailing !
// means "whole Tamil word", a trailing * means "English prefix".
//
// Rule order (first match wins):
//   context mistake fields > abuse/probe > small talk > identity >
//   answers-for-a-test > results/privacy > teacher paper > follow-ups
//   (simpler / reveal / practice / example) > practice attempt > mistake >
//   coverage > Tamil term > not published > materials > topic (definition /
//   procedure / explanation) > website FAQ > off-topic > not covered >
//   weak FAQ > topic from history > unknown

import { compilePhrase, findPhrase, tokenize, normalize } from '../lang.js';
import { extractCitationIds } from '../sanitize.js';
import { matchTopic, matchFaq, lexiconHit } from './match.js';
import { parsePracticeRef, resolvePracticeRef, conceptForPractice } from './questions.js';

const C = (list) => list.map(compilePhrase);

export const CUES = {
  greeting: C(['hi', 'hello', 'hey', 'hai', 'hii', 'hiii', 'good morning', 'good afternoon', 'good evening', 'vanakkam', 'namaste', 'namaskaram', 'greetings', 'வணக்கம்!', 'ஹலோ!', 'ஹாய்!']),
  thanks: C(['thanks', 'thank you', 'thank u', 'thanku', 'thankyou', 'thx', 'tq', 'nandri', 'much appreciated', 'நன்றி!', 'நன்றிகள்!']),
  farewell: C(['bye', 'goodbye', 'good bye', 'bye bye', 'see you', 'see ya', 'good night', 'take care', 'tata', 'போய் வருகிறேன்', 'சென்று வருகிறேன்', 'விடைபெறுகிறேன்', 'பிறகு சந்திப்போம்', 'பை பை']),
  identity: C([
    'who are you', 'what are you', 'what is irushy', 'who is irushy', 'are you a human', 'are you human', 'are you a person',
    'are you a teacher', 'are you a real teacher', 'are you a robot', 'are you a bot', 'are you an ai', 'are you ai', 'are you real',
    'your name', 'who made you', 'who created you', 'who built you', 'are you chatgpt', 'are you gemini',
    'நீங்கள் யார்', 'நீ யார்', 'உங்கள் பெயர்', 'உன் பெயர்', 'நீங்கள் ஆசிரியரா', 'நீ ஆசிரியரா', 'நீங்கள் மனிதரா', 'நீ மனிதனா', 'நீங்கள் ரோபோவா', 'இருஷி யார்'
  ]),
  answerWords: C(['answer', 'answers', 'solution', 'solutions', 'correct option', 'right option', 'answer key', 'key answer', 'விடை', 'விடைகள்', 'தீர்வு', 'விடைக்குறிப்பு', 'சரியான விடை']),
  testWords: C([
    'test', 'tests', 'exam', 'exams', 'examination', 'quiz', 'assessment', 'one word test', 'online test', 'question paper',
    'question no', 'question number', 'q no', 'paper', 'தேர்வு', 'பரீட்சை', 'வினாத்தாள்', 'வினா எண்', 'கேள்வி எண்'
  ]),
  practiceWords: C(['practice', 'practise', 'பயிற்சி']),
  paperWords: C(['question paper', 'test paper', 'exam paper', 'model paper', 'paper', 'blueprint', 'வினாத்தாள்', 'கேள்வித்தாள்', 'தேர்வுத்தாள்']),
  buildVerbs: C(['make', 'build', 'create', 'prepare', 'generate', 'set', 'design', 'draft', 'compose', 'தயாரி', 'தயார் செய்', 'உருவாக்கு', 'அமை']),
  keyWord: C(['key', 'answer key', 'விடைக்குறிப்பு']),
  results: C([
    'my result*', 'my mark*', 'my score*', 'result*', 'mark sheet', 'marksheet', 'student mark*', 'student result*', 'scores',
    'did i pass', 'pass or fail', 'my rank', 'my grade', 'என் மதிப்பெண்', 'எனது மதிப்பெண்', 'மதிப்பெண்கள் என்ன', 'மாணவர் மதிப்பெண்',
    'முடிவு', 'முடிவுகள்', 'ரிசல்ட்', 'தேர்ச்சி பெற்றேனா'
  ]),
  privacy: C([
    'privacy', 'private', 'store my', 'save my', 'do you store', 'do you save', 'do you keep', 'do you record', 'record my',
    'what do you know about me', 'what can you see', 'my data', 'my personal', 'personal data', 'personal information', 'track me', 'cookies',
    'தனியுரிமை', 'சேமிக்கிறீர்களா', 'சேமிப்பீர்களா', 'என்னைப் பற்றி', 'என் தகவல்', 'தனிப்பட்ட தகவல்'
  ]),
  simpler: C([
    'more simply', 'simpler', 'explain simply', 'in simple words', 'in simple terms', 'in simple language', 'simple words', 'simple way',
    'easier', 'easy way', 'easy words', 'dont understand', "don't understand", 'do not understand', 'didnt understand', "didn't understand",
    'not clear', 'confusing', 'confused', 'eli5', 'break it down', 'explain again', 'once more', 'எளிமையாக', 'எளிமை', 'எளிதாக',
    'சுலபமாக', 'புரியவில்லை', 'புரியல', 'மீண்டும் விளக்குங்கள்'
  ]),
  example: C(['example', 'examples', 'for instance', 'show me how', 'worked example', 'எடுத்துக்காட்டு', 'உதாரணம்', 'உதாரணமாக']),
  similar: C([
    'similar question', 'similar practice question', 'similar one', 'another question', 'one more question', 'next question', 'another one',
    'இதே போன்ற', 'இன்னொரு வினா', 'மற்றொரு வினா', 'வேறு வினா', 'இன்னொரு கேள்வி', 'வேறு கேள்வி', 'அடுத்த வினா'
  ]),
  practiceRequest: C([
    'practice question', 'practise question', 'practice questions', 'practice problem', 'practice test', 'quiz me', 'test me', 'ask me a question',
    'ask me question', 'give me a question', 'give me question', 'give me some question', 'a question on', 'question on', 'questions on',
    'question about', 'mcq', 'exercise', 'பயிற்சி வினா', 'பயிற்சிக் கேள்வி', 'பயிற்சி கேள்வி', 'வினா கேளுங்கள்', 'கேள்வி கேளுங்கள்',
    'வினா கேள்', 'கேள்வி கேள்', 'வினா தாருங்கள்', 'வினா கொடுங்கள்'
  ]),
  reveal: C([
    'show the answer', 'show answer', 'show me the answer', 'what is the answer', "what's the answer", 'whats the answer', 'tell me the answer',
    'give me the answer', 'give the answer', 'reveal', 'answer please', 'the answer', 'விடையைக் காட்டு', 'விடை காட்டு', 'விடையைக் காட்டுங்கள்',
    'விடை என்ன', 'விடையைச் சொல்', 'விடை சொல்', 'சரியான விடை என்ன'
  ]),
  dontKnow: C(['i dont know', "i don't know", 'i do not know', 'no idea', 'not sure', 'skip', 'தெரியவில்லை', 'தெரியாது', 'தெரியல']),
  mistakeWords: C([
    'my mistake', 'my mistakes', 'why is my answer wrong', 'why was my answer wrong', 'why did i get it wrong', 'where did i go wrong',
    'explain my mistake', 'explain my answer', 'my wrong answer', 'i got wrong', 'got it wrong', 'என் தவறு', 'நான் செய்த தவறு', 'என் விடை ஏன் தவறு',
    'ஏன் தவறு', 'தவறை விளக்கு'
  ]),
  coverage: C([
    'what topics', 'which topics', 'what can you teach', 'what can you explain', 'what subjects', 'which subjects', 'topics you cover',
    'what do you cover', 'coverage', 'what can you do', 'what can you help', 'how can you help', 'list of topics', 'list topics', 'topic list',
    'what do you know', 'எந்தெந்த தலைப்புகள்', 'என்ன தலைப்புகள்', 'எந்த தலைப்புகள்', 'எந்த பாடங்கள்', 'என்ன பாடங்கள்', 'எந்தெந்த பாடங்கள்',
    'என்ன செய்ய முடியும்', 'எதற்கு உதவ', 'என்ன உதவி செய்ய', 'எதை விளக்க முடியும்'
  ]),
  termHelpStrong: C([
    'tamil word', 'tamil term', 'tamil meaning', 'meaning in tamil', 'tamil name', 'tamil for', 'english word', 'english term',
    'english meaning', 'தமிழில் என்ன', 'தமிழ்ச் சொல்', 'தமிழ் சொல்', 'கலைச்சொல்', 'தமிழில் எப்படி', 'ஆங்கிலத்தில் என்ன',
    'ஆங்கிலச் சொல்', 'ஆங்கில சொல்'
  ]),
  // "in Tamil" alone only counts together with a definition cue
  // ("what is RAM in Tamil"), so "Can IRUSHY answer in Tamil?" is not a term question.
  termHelpWeak: C(['in tamil', 'in english']),
  materials: C([
    'material*', 'notes', 'note', 'pdf*', 'download*', 'study material', 'book back', 'textbook', 'guide', 'practical*', 'lesson', 'lessons',
    'chapter', 'chapters', 'syllabus', 'question bank', 'minimum material', 'slow learner*', 'previous year', 'model question', 'one mark*',
    'evaluation', 'ppt', 'presentation', 'answer key', 'answerkey', 'key answer', 'பாடக்குறிப்பு', 'குறிப்புகள்', 'பாடப்பொருள்', 'புத்தக', 'பதிவிறக்க', 'செய்முறை', 'பாடத்திட்டம்'
  ]),
  requestVerbs: C(['give', 'send', 'list', 'show', 'need', 'want', 'get', 'share', 'any', 'தா', 'கொடு', 'வேண்டும்', 'அனுப்பு', 'காட்டு', 'தாருங்கள்', 'கொடுங்கள்']),
  whereWords: C(['where', 'link', 'which page', 'எங்கே', 'எங்கு', 'இணைப்பு']),
  procedure: C([
    'how do i', 'how to', 'how can i', 'how do you', 'how does', 'how do we', 'steps to', 'steps for', 'procedure', 'method to', 'way to',
    'process of', 'how is', 'how are', 'எப்படி', 'எவ்வாறு', 'வழிமுறை', 'படிகள்', 'செய்வது எப்படி'
  ]),
  definition: C([
    'what is', 'what are', "what's", 'whats', 'define', 'definition', 'meaning of', 'what does', 'what do you mean', 'stands for',
    'full form', 'abbreviation', 'என்றால் என்ன', 'என்பது என்ன', 'என்ன என்பது', 'என்றால் என்னவென்று', 'பொருள் என்ன', 'வரையறு', 'வரையறை', 'விரிவாக்கம்'
  ]),
  explainWords: C([
    'explain', 'tell me about', 'teach me', 'describe', 'learn', 'help me understand', 'overview', 'introduction to', 'what about',
    'tell me more', 'more about', 'விளக்கு', 'விளக்கம்', 'விளக்குங்கள்', 'பற்றி சொல்', 'பற்றிச் சொல்', 'பற்றி கூறு', 'பற்றிக் கூறு',
    'கற்றுக்கொடு', 'கற்றுத் தா', 'சொல்லித் தா', 'சொல்லிக் கொடு'
  ]),
  tellMore: C(['more', 'continue', 'go on', 'and then', 'மேலும்', 'இன்னும் சொல்', 'தொடர்ந்து']),
  visual: C(['diagram', 'picture', 'image', 'chart', 'figure', 'video', 'videos', 'draw', 'visual', 'படம்', 'வரைபடம்', 'வீடியோ', 'காணொளி']),
  video: C(['video', 'videos', 'youtube', 'வீடியோ', 'காணொளி']),
  directedAtYou: C(['you', 'u', 'your', 'ur', 'bot', 'irushy', 'this assistant', 'நீ', 'உன்', 'உனக்கு', 'நீங்க', 'நீங்கள்'])
};

const FILLERS = new Set([
  'irushy', 'sir', 'madam', 'mam', 'maam', 'friend', 'dear', 'there', 'all', 'everyone', 'again', 'so', 'much', 'very', 'a', 'lot',
  'you', 'to', 'for', 'the', 'help', 'your', 'ok', 'okay', 'great', 'good', 'nice', 'super', 'and', 'once', 'bro',
  'ஐயா', 'அம்மா', 'சார்', 'மேடம்', 'மிக்க', 'ரொம்ப', 'உங்களுக்கு', 'இருஷி', 'நண்பா'
]);

export function hasCue(name, tokens) {
  const list = CUES[name];
  if (!list) throw new Error(`unknown cue list ${name}`);
  for (const p of list) if (findPhrase(p, tokens) >= 0) return p.phrase;
  return null;
}

function smallTalk(tokens) {
  const rest = tokens.slice();
  const found = [];
  for (const kind of ['farewell', 'thanks', 'greeting']) {
    for (const p of CUES[kind]) {
      let i;
      while ((i = findPhrase(p, rest)) >= 0) {
        rest.splice(i, p.units.length);
        if (!found.includes(kind)) found.push(kind);
      }
    }
  }
  const leftover = rest.filter((t) => !FILLERS.has(t));
  return { found, pure: found.length > 0 && leftover.length === 0 };
}

// Short replies right after a practice question are treated as attempts.
function looksLikeAttempt(raw, tokens) {
  if (raw.length > 80 || tokens.length === 0 || tokens.length > 6) return false;
  if (/\?\s*$/.test(raw) && tokens.length > 3) return false;
  for (const cue of ['definition', 'procedure', 'explainWords', 'materials', 'coverage', 'simpler', 'similar', 'practiceRequest']) {
    if (hasCue(cue, tokens)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// What the recent history tells us (history is untrusted: every id is
// checked against the loaded data before it is used).
// ---------------------------------------------------------------------------
export function historyState(history, knowledge) {
  const turns = Array.isArray(history) ? history : [];
  let lastAssistant = null;
  let lastUser = null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (!lastAssistant && turns[i].role === 'assistant') lastAssistant = turns[i];
    if (!lastUser && turns[i].role === 'user') lastUser = turns[i];
  }
  const cited = lastAssistant ? extractCitationIds(lastAssistant.content).filter((id) => knowledge.idIndex.has(id)) : [];

  let practiceRef = null;
  if (lastAssistant) {
    const ref = parsePracticeRef(lastAssistant.content);
    if (ref && resolvePracticeRef(knowledge, ref)) practiceRef = ref;
  }
  const shownPractice = [];
  for (const t of turns) {
    if (t.role !== 'assistant') continue;
    const ref = parsePracticeRef(t.content);
    if (ref && !shownPractice.includes(ref) && resolvePracticeRef(knowledge, ref)) shownPractice.push(ref);
  }

  let conceptId = null;
  let conceptVia = null;
  for (const id of cited) {
    if (knowledge.idIndex.get(id).kind === 'concept') {
      conceptId = id;
      conceptVia = 'history-citation';
      break;
    }
  }
  if (!conceptId && practiceRef) {
    const c = conceptForPractice(knowledge, resolvePracticeRef(knowledge, practiceRef));
    if (c) {
      conceptId = c.id;
      conceptVia = 'history-practice-ref';
    }
  }
  if (!conceptId) {
    for (const id of cited) {
      const topic = knowledge.idIndex.get(id).entry.topic;
      const c = topic ? knowledge.concepts.find((x) => x.topic === topic) : null;
      if (c) {
        conceptId = c.id;
        conceptVia = 'history-citation-topic';
        break;
      }
    }
  }
  if (!conceptId && lastUser) {
    const m = matchTopic(knowledge, lastUser.content);
    if (m.best && m.best.score >= 1) {
      conceptId = m.best.concept.id;
      conceptVia = 'history-user-text';
    }
  }
  return {
    turns: turns.length,
    cited,
    practiceRef,
    shownPractice,
    conceptId,
    conceptVia,
    lastFaq: cited.find((id) => id.startsWith('faq.')) || null
  };
}

// ---------------------------------------------------------------------------
export function classify({ message, mode = 'home', history = [], context = {}, knowledge }) {
  const raw = String(message || '');
  const tokens = tokenize(raw);
  const state = historyState(history, knowledge);
  const topic = matchTopic(knowledge, raw);
  const faq = matchFaq(knowledge, raw, mode);
  const ctx = context && typeof context === 'object' ? context : {};
  const cue = (name) => hasCue(name, tokens);
  const lex = (name) => lexiconHit(knowledge, name, raw);

  const signals = {
    topic: topic.best,
    topicAlternatives: topic.all.slice(1, 3).map((t) => ({ id: t.concept.id, score: t.score })),
    faq: faq.best,
    faqAlternatives: faq.all.slice(1, 3).map((f) => ({ id: f.faq.id, score: f.score })),
    state,
    wantsVisual: !!cue('visual'),
    wantsVideo: !!cue('video')
  };
  const decide = (intent, confidence, rule, extra = {}) => ({ intent, confidence, rule, signals: { ...signals, ...extra } });

  // 1. structured mistake-explanation request from the test page
  if (ctx.question && (ctx.selectedAnswer !== undefined || ctx.correctAnswer !== undefined)) {
    return decide('mistake_explanation', 0.99, 'context-fields');
  }

  // 2. abuse and probing
  if (lex('abuseStrong')) return decide('abuse', 0.97, 'profanity');
  if (lex('abuseTamil')) return decide('abuse', 0.93, 'tamil-insult');
  if (lex('abuseInsults') && cue('directedAtYou')) return decide('abuse', 0.9, 'directed-insult');
  if (lex('probes')) return decide('abuse', 0.9, 'probe', { probe: true });

  // 3. small talk (the whole message is a greeting / thanks / goodbye)
  const st = smallTalk(tokens);
  if (st.pure) return decide(st.found[0], 0.97, 'small-talk');

  // 4. who/what is IRUSHY
  if (cue('identity')) return decide('identity', 0.95, 'identity');

  const answerCue = cue('answerWords');
  const testCue = cue('testWords');
  const practiceCue = cue('practiceWords');
  const paperCue = cue('paperWords');
  const buildCue = cue('buildVerbs');

  // 5. answers for a test (refused unless a signed token says completed)
  if (answerCue && testCue && !practiceCue && !(mode === 'teacher' && (paperCue || buildCue))) {
    return decide('assessment_request', 0.9, 'answers-for-a-test', { cues: [answerCue, testCue] });
  }

  // 6. results / privacy
  const resultsCue = cue('results');
  const privacyCue = cue('privacy');
  if (resultsCue || privacyCue) {
    return decide('results_privacy', 0.88, resultsCue && privacyCue ? 'results+privacy' : resultsCue ? 'results' : 'privacy', {
      results: !!resultsCue,
      privacy: !!privacyCue
    });
  }

  // 7. teacher paper builder
  if ((paperCue && buildCue) || (mode === 'teacher' && (paperCue || (answerCue && cue('keyWord'))))) {
    return decide('teacher_paper', 0.88, 'paper-request');
  }

  // 8. follow-ups
  const pending = state.practiceRef;
  if (cue('simpler')) return decide('explain_simpler', 0.92, 'simpler');
  // "what is the answer key for 11th CS" is a materials question, not a reveal.
  const revealCue = cue('reveal') && (pending || !(cue('materials') || classOf(raw) || subjectOf(raw)));
  if (revealCue || (pending && cue('dontKnow') && tokens.length <= 6)) return decide('practice_answer', 0.9, 'reveal', { reveal: true });
  const similarCue = cue('similar');
  const practiceReq = cue('practiceRequest');
  if (similarCue || practiceReq) {
    const websiteTest = practiceReq === 'practice test' && !topic.best && cue('whereWords');
    if (!websiteTest) return decide('practice_question', 0.9, similarCue ? 'similar' : 'request');
  }
  if (cue('example') && !cue('explainWords')) return decide('show_example', 0.9, 'example');

  // 9. an attempt at the pending practice question
  if (pending && looksLikeAttempt(raw, tokens)) return decide('practice_answer', 0.8, 'attempt', { reveal: false });

  // 10. "why was my answer wrong" without the test page's context
  if (cue('mistakeWords')) return decide('mistake_explanation', 0.85, 'mistake-words');

  // 11. coverage
  if (cue('coverage')) return decide('coverage', 0.85, 'coverage');

  // 12. Tamil / English term
  if ((cue('termHelpStrong') || (cue('termHelpWeak') && cue('definition'))) && !cue('explainWords') && tokens.length <= 12) {
    return decide('term_help', 0.88, 'term');
  }

  // 13. things the site does not publish
  const np = lex('notPublished');
  if (np) return decide('not_published', 0.85, 'not-published', { thing: np });

  // 14. a specific materials request
  const materialsCue = cue('materials') || (paperCue && !buildCue ? paperCue : null);
  if (materialsCue) {
    const specific = !!(classOf(raw, ctx) || subjectOf(raw, ctx) || mediumOf(raw, ctx, true) || topic.best || cue('requestVerbs') || materialWords(raw).length);
    if (specific) return decide('materials', 0.85, 'materials-specific');
  }

  // 15. a topic from the concept notes
  if (topic.best && topic.best.score >= 1) {
    const procedureCue = cue('procedure');
    const definitionCue = cue('definition');
    const explainCue = cue('explainWords');
    if (procedureCue && faq.best && faq.best.score >= 2.5 && faq.best.score > topic.best.score + 1) return decide('website_help', 0.8, 'faq-procedure');
    if (definitionCue && !explainCue) return decide('definition', 0.85, 'definition');
    if (procedureCue && !explainCue) return decide('procedure', 0.8, 'procedure');
    if (topic.best.term && !explainCue && !cue('visual')) return decide('definition', 0.75, 'term-named');
    return decide('topic_explanation', explainCue ? 0.85 : 0.7, explainCue ? 'explain' : 'topic-named', { includeExample: !!cue('example') });
  }

  // 16. a website question
  if (faq.best && faq.best.score >= 1.8) return decide('website_help', 0.8, 'faq');
  if (materialsCue) return decide('website_help', 0.75, 'materials-where', { faqId: 'faq.find-materials' });

  // 17. clearly outside IRUSHY's scope
  const off = lex('offTopic');
  if (off) return decide('off_topic', 0.8, 'off-topic', { thing: off });
  const other = lex('otherSubjects');
  if (other) return decide('off_topic', 0.8, 'other-subject', { thing: other, otherSubject: true });

  // 18. computing, but not in the notes
  const nc = lex('computingNotCovered');
  if (nc) return decide('unknown', 0.6, 'not-covered', { thing: nc });

  // 19. a weaker website match
  if (faq.best && faq.best.score >= 1.2) return decide('website_help', 0.55, 'faq-weak');

  // 20. "explain more" with a topic from the conversation
  if ((cue('explainWords') || cue('tellMore')) && state.conceptId) return decide('topic_explanation', 0.6, 'history-topic');

  return decide('unknown', 0.2, 'fallback');
}

// ---------------------------------------------------------------------------
// filters used by the materials composer (also exported for it)
// ---------------------------------------------------------------------------
export function classOf(raw, ctx = {}) {
  const s = String(raw);
  if (/\b12(?:th)?\b|\bxii\b|plus\s*two|\+\s*2\b|பன்னிரண்டாம்|12\s*-?\s*ஆம்/i.test(s)) return 12;
  if (/\b11(?:th)?\b|\bxi\b|plus\s*one|\+\s*1\b|பதினொன்றாம்|11\s*-?\s*ஆம்/i.test(s)) return 11;
  if (ctx.class === 11 || ctx.class === 12) return ctx.class;
  return null;
}

export function subjectOf(raw, ctx = {}) {
  const s = normalize(raw);
  if (/computer\s*applications?|\bca\b|கணினிப்?\s*பயன்பாடு/.test(s)) return 'Computer Applications';
  if (/computer\s*technology|\bct\b|கணினித்?\s*தொழில்நுட்பம்/.test(s)) return 'Computer Technology';
  if (/computer\s*science|\bcs\b|கணினி\s*அறிவியல்/.test(s)) return 'Computer Science';
  if (['Computer Science', 'Computer Applications', 'Computer Technology'].includes(ctx.subject)) return ctx.subject;
  return null;
}

export function mediumOf(raw, ctx = {}, strict = false) {
  const s = normalize(raw);
  if (/tamil\s*medium|தமிழ்\s*வழி/.test(s)) return 'Tamil Medium';
  if (/english\s*medium|ஆங்கில\s*வழி/.test(s)) return 'English Medium';
  if (!strict) {
    if (/\btamil\b|தமிழ்/.test(s)) return 'Tamil Medium';
    if (/\benglish\b|ஆங்கில/.test(s)) return 'English Medium';
  }
  if (['Tamil Medium', 'English Medium'].includes(ctx.medium)) return ctx.medium;
  return null;
}

const MATERIAL_TYPES = [
  ['practical', /practical|செய்முறை/],
  ['book back', /book\s*back|புத்தக\s*வினா/],
  ['one word', /one\s*word|one\s*mark|ஒரு\s*மதிப்பெண்|ஒரு\s*வார்த்தை/],
  ['question paper', /question\s*paper|வினாத்தாள்/],
  ['answer key', /answer\s*key|key\s*answer|answerkey|விடைக்குறிப்பு/],
  ['syllabus', /syllabus|பாடத்திட்டம்/],
  ['slow learners', /slow\s*learner|minimum\s*material|mlm/],
  ['question bank', /question\s*bank|வினா\s*வங்கி/],
  ['evaluation', /evaluat|evaluvat/],
  ['presentation', /\bppt\b|presentation|power\s*point/],
  ['lesson', /lesson|chapter|பாடம்\s*\d|அத்தியாயம்/],
  ['5 marks', /5\s*marks?|five\s*marks?|5\s*மதிப்பெண்/]
];

export function materialWords(raw) {
  const s = normalize(raw);
  return MATERIAL_TYPES.filter(([, re]) => re.test(s)).map(([name]) => name);
}

export function lessonNumber(raw) {
  const m = normalize(raw).match(/(?:lesson|chapter|பாடம்|அத்தியாயம்)\s*-?\s*(\d{1,2})/);
  return m ? Number(m[1]) : null;
}
