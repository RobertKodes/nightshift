/**
 * What may not be a NIGHTSHIFT company or product: illegal goods and services, adult content, scams
 * and fraud, hate and violence, fake reviews and followers, spam and unsolicited outreach, and
 * health cures. A word list read with care: "a scam checker" and "phishing awareness training" are
 * fine, "sell phishing kits" is not. It runs when a company is founded, whenever its owner or its
 * CEO rewrites what it is or sells, and over existing companies at start (they are hidden, never
 * deleted). A model may add its own verdict at founding; this list is the floor that needs no model.
 */
export type ScreenCategory = "adult" | "illegal" | "scam" | "violence" | "deception" | "spam" | "health";

export type Screened = { ok: true } | { ok: false; category: ScreenCategory; reason: string };

const LABEL: Record<ScreenCategory, string> = {
  adult: "adult or sexual content",
  illegal: "illegal goods or services",
  scam: "a scam, fraud or a promise of guaranteed money",
  violence: "violence or hate",
  deception: "fake reviews, fake followers, forged documents or impersonation",
  spam: "spam or unsolicited outreach",
  health: "medical cures or prescription drugs",
};

/** Said to a founder whose idea is refused. */
export const refusal = (category: ScreenCategory) =>
  `This cannot be a NIGHTSHIFT company: it involves ${LABEL[category]}. Companies here sell legal, safe-for-work digital goods and services. Describe a different idea.`;

// Terms that are wrong whatever surrounds them.
const HARD: [ScreenCategory, RegExp][] = [
  ["adult", /\b(?:porn\w*|xxx|nsfw|onlyfans|only fans|escorts?|escorting|erotic\w*|nudes?|nudity|camgirls?|cam girls?|fetish\w*|hentai|sexting|sexcams?|sex (?:chat|toys?|work\w*|tapes?|dolls?|videos?|stories|content|sites?|cams?)|sexy|sexual (?:content|services?|images?|videos?|fantasies|roleplay)|adult (?:content|videos?|films?|movies|models?|entertainment|sites?|chat|stories|games?)|strip ?clubs?|brothels?|csam|lolicon)\b/],
  ["illegal", /\b(?:cocaine|heroin|methamphetamine|crystal meth|fentanyl|mdma|ecstasy pills?|lsd tabs?|illegal drugs?|drug (?:deal\w*|traffick\w*|smuggl\w*)|ghost guns?|untraceable (?:guns?|firearms?)|silencers?|explosives?|bomb[- ]making|counterfeit\w*|fake (?:ids?|passports?|diplomas?|degrees?|certificates?|money|banknotes?|licen[cs]es?|doctor'?s? notes?|prescriptions?|pay ?stubs?|bank statements?)|forged? (?:documents?|signatures?|papers)|stolen (?:cards?|credit cards?|accounts?|data|goods|identities)|carding|fullz|cvv dumps?|credit card dumps?|hacked accounts?|account cracking|ddos[- ]for[- ]hire|booter service|stresser service|human traffick\w*|organ (?:trade|sales?)|money launder\w*|launder(?:ing)? money|tax evasion|evade tax\w*|insider trading|pirated (?:software|movies|films|games|courses|books|content)|cracked (?:software|accounts?|games)|warez|bypass (?:drm|paywalls?)|exam answers? leak\w*|buy (?:essays?|dissertations?)|essay mills?|cheat on (?:exams?|tests?))\b/],
  ["scam", /\b(?:ponzi|pyramid schemes?|pump[- ]and[- ]dump|rug ?pulls?|get[- ]rich[- ]quick|guaranteed (?:returns?|profits?|income|wins?|roi|winnings)|risk[- ]free (?:returns?|profits?)|double your (?:money|crypto|bitcoin|eth|investment)|romance scams?|advance[- ]fee|fake giveaways?|fake airdrops?|wallet drainers?|seed phrase (?:phish\w*|steal\w*)|scamming|scam (?:people|users|victims|buyers|investors)|defraud\w*|run (?:a |an )?scams?)\b/],
  ["violence", /\b(?:hitm[ae]n|murder[- ]for[- ]hire|contract killing|kill (?:people|someone|him|her|them)|white supremac\w*|neo[- ]?nazi\w*|ethnic cleansing|genocide (?:guide|merch|support)|terroris[mt] (?:financing|recruit\w*|manual|training)|school shoot\w*|swatting|doxx?ing|revenge porn|stalkerware|stalk (?:my|your|an?) (?:ex|girlfriend|boyfriend|wife|husband|partner))\b/],
  ["deception", /\b(?:fake (?:reviews?|testimonials?|followers?|likes|subscribers?|ratings?|engagement|traffic|accounts?|profiles?|news|endorsements?)|buy (?:followers?|likes|reviews?|subscribers?|ratings?)|paid (?:5|five)[- ]star reviews?|review (?:farm\w*|manipulation)|astroturf\w*|sock ?puppets?|impersonat\w*|deepfakes? (?:of|porn|nudes?)|catfish\w*|click ?farms?|bot (?:followers|traffic|views))\b/],
  ["spam", /\b(?:spam (?:bots?|emails?|campaigns?|tools?|software|lists?)|spamming|spambots?|mass (?:dms?|dming|messaging|emailing)|bulk (?:dms?|sms|emails?) (?:blasts?|sender|sending)|unsolicited (?:emails?|dms?|messages?|outreach|sms)|scraped (?:emails?|leads?|contacts?|phone numbers?)|email lists? for sale|sell (?:email|lead|contact) lists?|robocall\w*|cold[- ]dm (?:bots?|automation)|auto[- ]?dm bots?)\b/],
  ["health", /\b(?:miracle cures?|cures? (?:cancer|diabetes|hiv|aids|covid|autism|depression)|prescription (?:drugs?|pills?|meds|medication) (?:without|no) (?:a )?prescription|no[- ]prescription (?:pills?|pharmacy|meds)|(?:buy|sell) (?:xanax|adderall|oxycodone|oxycontin|tramadol|viagra|ozempic|steroids?|sarms?|hgh)|anabolic steroids? (?:shop|store|for sale))\b/],
];

/** Categories whose terms an honest company may also name: to report them, spot them, filter them. */
const SOFT = new Set<ScreenCategory>(["deception", "spam", "scam"]);

// Terms that are fine when the company works against them, and wrong when it sells them.
const DUAL = /\b(?:scams?|frauds?|phishing|malware|ransomware|spyware|keyloggers?|botnets?|exploits? kits?|hacking|spam)\b/;
const AGAINST = /\b(?:anti|avoid\w*|detect\w*|prevent\w*|protect\w*|spot\w*|report\w*|against|awareness|defen[cs]\w*|check\w*|filter\w*|block\w*|stop\w*|fight\w*|safe\w*|secur\w*|audit\w*|verif\w*|warn\w*|educat\w*|train\w*|recogni[sz]\w*|recover\w*|learn\w*|ethical|bug bount\w*|pen(?:etration)?[- ]?test\w*|red[- ]team\w*|compliance|guard\w*|shield\w*|flag\w*|scan\w*)\b/;
const SELLS_HARM = /\b(?:sell\w*|build\w*|make\w*|creat\w*|writ\w*|generat\w*|run\w*|launch\w*|send\w*|rent\w*|deploy\w*|custom|kits?|as a service|for hire|templates? for)\b[^.;!?]{0,40}\b(?:scams?|frauds?|phishing|malware|ransomware|spyware|keyloggers?|botnets?|exploits? kits?|spam)\b/;

// Spelled around a filter: p0rn, p.o.r.n, c0caine.
const SQUASHED: [ScreenCategory, RegExp][] = [
  ["adult", /porn|hentai|onlyfans|camgirl|xxxvideo|nsfw/],
  ["illegal", /cocaine|heroin|fentanyl|methamphetamine|ransomware|counterfeit/],
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

function normal(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}

/** The check itself. `text` is everything the company says about itself, in one string. */
export function screenText(text: string): Screened {
  const t = normal(text);
  if (!t) return { ok: true };
  // fake reviews, spam and scams are also things an honest company reports, spots and filters: those
  // categories are read sentence by sentence, and a sentence that works against them passes
  const hard = (text: string): Screened | null => {
    for (const [category, re] of HARD) {
      if (!re.test(text)) continue;
      if (!SOFT.has(category)) return { ok: false, category, reason: refusal(category) };
      if (text.split(/[.;!?\n]+/).some((s) => re.test(s) && !AGAINST.test(s))) return { ok: false, category, reason: refusal(category) };
    }
    return null;
  };
  const plain = hard(t);
  if (plain) return plain;
  // read again as written around a filter: digits as letters, then letters only
  const leet = t.replace(/[013457@$!](?=[a-z])|(?<=[a-z])[013457@$!]/g, (ch) => LEET[ch] ?? ch);
  const again = leet !== t ? hard(leet) : null;
  if (again) return again;
  const squashed = leet.replace(/[^a-z]/g, "");
  for (const [category, re] of SQUASHED) if (re.test(squashed) && !re.test(t.replace(/[^a-z ]/g, ""))) return { ok: false, category, reason: refusal(category) };
  if (DUAL.test(t)) {
    // sentence by sentence: the harmful term must sit with a word that works against it
    for (const s of t.split(/[.;!?\n]+/)) {
      if (!DUAL.test(s)) continue;
      if (SELLS_HARM.test(s) && !AGAINST.test(s)) return { ok: false, category: /spam/.test(s) ? "spam" : /scam|fraud/.test(s) ? "scam" : "illegal", reason: refusal(/spam/.test(s) ? "spam" : /scam|fraud/.test(s) ? "scam" : "illegal") };
    }
  }
  return { ok: true };
}

/** Everything a company says about itself and sells, screened together. */
export function screenCompany(c: { name: string; idea: string; mission: string; audience: string; direction?: string; products?: { name: string; pitch: string; status?: string }[] }): Screened {
  return screenText([c.name, c.idea, c.mission, c.audience, c.direction ?? "", ...(c.products ?? []).filter((p) => p.status !== "retired").map((p) => `${p.name}. ${p.pitch}`)].join(". "));
}
