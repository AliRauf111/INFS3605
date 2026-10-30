# Translations: how they work and what still needs review

Tutor Compass is offered in fourteen languages. English is the default and the fallback for any
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
| `ta` | Tamil | First draft, needs a fluent reviewer |
| `te` | Telugu | First draft, needs a fluent reviewer |
| `mr` | Marathi | First draft, needs a fluent reviewer |
| `bn` | Bengali | First draft, needs a fluent reviewer |

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
- Anything Compass saves: drafts, previews once prepared, audit notes and run summaries.
  Saved records stay in English so the owner and audit trail read the same for everyone.
- Typed questions in demo mode are matched on English keywords. The four shortcuts work in
  every language, and live AI understands any language.
- Names, booking references, notes, original messages and owner-written policies
- HSC course names
- Most server error messages and developer setup errors
- Voice dictation listens in Australian English, and read-aloud speaks British English

## Compass AI replies

Compass now answers in the reader's language. The reply text lives in the `reply` area
(`src/locales/<code>/reply.json`, built from `_sources/<code>.90.txt` to `.92.txt`). With live
AI switched on, Compass is told to write in the reader's language and never soften,
strengthen or change a rule, a colour or a decision.

What does not change with the language, and is covered by `tests/compass-languages.test.ts`:

- Who may do what. Permissions and the owner approval step give identical results in every
  language.
- Every policy ID, booking, family, invoice and payment reference, file name and number in
  a reply. The test fails if a translation drops one.
- Saved and audit text, which is always written in English.

### Terms a reviewer should check first

These carry the business meaning, so a wrong word here matters more than awkward phrasing.

| Language | owner | admin | request | booking | lesson | invoice |
| --- | --- | --- | --- | --- | --- | --- |
| Tamil | உரிமையாளர் | நிர்வாகி | கோரிக்கை | முன்பதிவு | வகுப்பு | விலைப்பட்டியல் |
| Telugu | యజమాని | అడ్మిన్ | అభ్యర్థన | బుకింగ్ | పాఠం | ఇన్‌వాయిస్ |
| Marathi | मालक | ॲडमिन | विनंती | बुकिंग | धडा | इनव्हॉइस |
| Bengali | মালিক | অ্যাডমিন | অনুরোধ | বুকিং | ক্লাস | চালান |
| Mandarin | 负责人 | 管理员 | 请求 | 预约 | 课程 | 发票 |
| Cantonese | 老闆 | 管理員 | 請求 | 預約 | 堂 | 發票 |
| Spanish | propietario | administrador | solicitud | reserva | clase | factura |
| Italian | titolare | amministratore | richiesta | prenotazione | lezione | fattura |
| Greek | ιδιοκτήτης | διαχειριστής (role), διοίκηση (status) | αίτημα | κράτηση | μάθημα | τιμολόγιο |
| Vietnamese | chủ | quản trị viên | yêu cầu | lịch học | buổi học | hóa đơn |
| Arabic | المالك | المسؤول | طلب | الحجز | الدرس | فاتورة |

The decision lines ("This one has to go to the owner", "needs the owner's approval",
"within your authority") were read back against English in all thirteen languages in the
second review pass and keep their meaning. They still need a fluent check for tone.

### Flagged for native-speaker review

- Welfare and safeguarding wording in every language. It must stay calm and never sound
  like a diagnosis.
- Payment and refund amounts in sentences, because word order around `{{amount}}` changes
  between languages.
- Arabic plural forms (two, few and many) and right-to-left layout of mixed IDs such as
  `BK-1042`.
- Cantonese colloquial forms in replies, and whether 老闆 or 負責人 suits the business better.
- Greek uses διαχειριστής for the admin role but διοίκηση in status names such as
  "Ready for Admin". A reviewer should pick one.
- Telugu spells invoice two ways (with and without a zero-width joiner). They look the same
  but a reviewer may want one spelling.
- Telugu, Marathi and Bengali use some English loanwords (booking, invoice, admin) because
  they are common in Australian community use. A reviewer may prefer native words.

### Second review pass (30 October 2026)

- Checked every string against English for missing keys, broken placeholders and text left
  in English. Fixed: "Year {{year}}" in Greek, Spanish, Italian, Hindi and Punjabi.
- Kept on purpose: "Tutor" in Spanish and Italian and "Account" in Italian, which are normal
  words there, plus templates that are only placeholders and punctuation.
