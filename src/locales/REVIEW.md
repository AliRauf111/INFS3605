# Translations: how they work and what still needs review

Tutor Compass is offered in ten languages. English is the default and the fallback for any
text a translation doesn't have.

| Code | Language | Status |
| --- | --- | --- |
| `en` | English | Source text |
| `zh-Hans` | Mandarin (Simplified Chinese) | First draft, needs a fluent reviewer |
| `ar` | Arabic | First draft, needs a fluent reviewer |
| `vi` | Vietnamese | First draft, needs a fluent reviewer |
| `yue-Hant` | Cantonese (Traditional Chinese) | First draft, needs a fluent reviewer |
| `pa` | Punjabi (Gurmukhi) | First draft, needs a fluent reviewer |
| `el` | Greek | First draft, needs a fluent reviewer |
| `it` | Italian | First draft, needs a fluent reviewer |
| `hi` | Hindi | First draft, needs a fluent reviewer |
| `es` | Spanish | First draft, needs a fluent reviewer |

None of the non-English text has been checked by a native speaker yet. Please treat every
language as a draft until someone fluent has read it in the app.

Cantonese is written colloquial Cantonese (嘅, 咗, 唔, 冇) in Traditional characters. It is
not the Mandarin text converted to another script. A reviewer should check it reads
naturally to a Hong Kong or Sydney Cantonese speaker.

## What a reviewer should check

1. Status names and traffic-light colours read the same way everywhere (Red, Yellow, Green,
   Send to Owner, Waiting for Owner and so on). They must keep their meaning, because staff
   use them to decide who acts.
2. The words for owner, admin, request, booking and tutor are consistent.
3. Plurals sound right for 0, 1, 2, 5 and 11 of something (Arabic uses all six forms).
4. Long labels still fit on a phone.

Product names stay in English on purpose: Tutor Compass, Compass AI, Knowledge Hub,
Approval Alley and Focus View. So do HSC course names, which are official titles.

## How to change a translation

1. Edit the line in `src/locales/_sources/<code>.N.txt`. Each line is `area.key=Text`.
   Keep every `{{placeholder}}` exactly as it is in English.
2. Run `npm run i18n:build -- <code>`. It checks every key against English, fills plural
   forms the language needs, and writes `src/locales/<code>/*.json`.
3. Run `npm run i18n:check` to confirm nothing is missing.

To add new English text, add it to `src/locales/en/<area>.json`, run `npm run i18n:index`,
then add the same key to each language's source file. Until a language has it, people see
the English text, never a raw key.

## What stays in English

These come from the server or from stored records, not from the interface files:

- Rule engine explanations and boundary-case wording
- Compass AI replies and the drafts it writes (the reply language is separate from the
  interface language and was not changed)
- Names, booking references, notes, original messages and owner-written policies
- HSC course names
- Most server error messages and developer setup errors
- Voice dictation listens in Australian English, and read-aloud speaks British English
