// Works out which form field is which on the proposal page, from the field list pageAgent
// returns (index, kind, label, placeholder). Pure. Label patterns are unverified against the
// logged-in form until a capture confirms them — see NOTES.md "Form roles".

const COVER_RE = /cover letter/i;
const RATE_RE = /hourly rate|your rate|\bbid\b|bid amount|total price|total amount|amount you'?d like|rate\s*\(/i;
const NOT_RATE_RE = /receive|service fee|fee\b|milestone|due date|connects/i;
const NOT_QUESTION_RE = /milestone|search|message|attachment|portfolio link/i;

export function classifyFields(fields = []) {
  const texts = fields.filter(f => f.kind === 'textarea' || f.kind === 'rich');
  let cover = texts.find(f => COVER_RE.test(f.label) || COVER_RE.test(f.placeholder));
  // No labelled cover letter: on a proposal page the first big text box is it.
  if (!cover && texts.length) cover = texts[0];
  const questions = texts
    .filter(f => f !== cover && !NOT_QUESTION_RE.test(f.label))
    .map(f => ({ index: f.index, label: f.label, text: questionText(f.label) }));
  const rate = fields.find(f => f.kind === 'input' && RATE_RE.test(`${f.label} ${f.placeholder}`) && !NOT_RATE_RE.test(f.label));
  return {
    cover: cover ? { index: cover.index, label: cover.label } : null,
    questions,
    rate: rate ? { index: rate.index, label: rate.label, value: rate.value || '' } : null,
  };
}

// Field labels sometimes carry a counter or hint after the question ("… 0/5000 characters").
export function questionText(label) {
  return String(label || '').replace(/\s*\d+\s*\/\s*\d+\s*(characters?)?\s*$/i, '').replace(/\s*\(optional\)\s*$/i, '').trim();
}

// Build the fill list for pageAgent('fill'). `auto` = triggered automatically (not your click):
// text fields are only filled when empty, and the rate only on the first automatic fill.
export function buildFillItems(form, draft, { fillRate = true, overwrite = false, auto = false, rateAlreadyAutoFilled = false } = {}) {
  const items = [];
  if (!form || !draft) return items;
  if (form.cover && draft.coverLetter) items.push({ role: 'cover', index: form.cover.index, label: form.cover.label, value: draft.coverLetter, overwrite: overwrite && !auto });
  form.questions.forEach((q, i) => {
    const a = draft.answers?.[i];
    if (a) items.push({ role: `q${i + 1}`, index: q.index, label: q.label, value: a, overwrite: overwrite && !auto });
  });
  if (fillRate && form.rate && draft.rate > 0 && !(auto && rateAlreadyAutoFilled)) {
    // Upwork pre-fills the rate field with your profile rate, so the rate is set even when non-empty.
    items.push({ role: 'rate', index: form.rate.index, label: form.rate.label, value: String(draft.rate), overwrite: true });
  }
  return items;
}
