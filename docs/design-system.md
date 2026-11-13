# 8&80 designsystem · versjon 1.0

Designsystemet gjør den eksisterende identiteten til et felles produktgrunnlag.
Det består av tokens, innfødte HTML-kontroller, små renderfunksjoner, sidemønstre
og en visuell håndbok. BRAND.md beskriver identiteten; dette dokumentet beskriver
hvordan den brukes og videreutvikles i tjenesten.

## Åpne og vedlikeholde håndboken

```sh
npm run design:preview
# http://127.0.0.1:8780

npm run design:build
# Håndbok, CSS, JSON-tokens, logoer, ikoner og kontrollsummer i brand/
```

Håndboken har temavalg, ekte radioknapper, skjematilstander og spørsmål som kan
åpnes. Byggede filer deles sammen med `brand/fonts/` og `brand/assets/`. Fontadressene er
relative i eksporten og lokale `/fonts/…` i produktet.

Forhåndsvisningen er skrivebeskyttet, lytter på loopback og bruker kun oppdiktede
eksempler. POST avvises. Den starter ingen database, samtaler, meldinger eller
betalinger. Den publiserer ingen ny rute i produksjon.

## Gjennomgang av dagens løsning

Gjennomført 8. november 2026. Publisert forside og tilgangsside ble kontrollert
i nettleser. Alle sidemaler, tilstander og e-postmalen ble gjennomgått i kildekoden.
Private kontoopplysninger ble ikke hentet fra produksjon. Visuell kontroll av
kundesidene bruker syntetiske data i den lokale forhåndsvisningen.

| Flate | Funn | Beslutning |
| --- | --- | --- |
| Forside og påmelding | En tydelig visuell idé; egen kopi av farger, knapper og radiovalg. Fontene som var navngitt, manglet. | Behold identitet og oppgavestruktur. Del tokens, kontroller og lokale fontfiler. |
| SMS-kode og tilgang | Samme oppgave, ulike skjema- og tittelregler. Fokus manglet som felles regel. | Ett kontrollgrunnlag, synlige etiketter og konsekvent hovedtittel. |
| Kundeside | Tidspunktet var godt prioritert, men egne feltgrenser, radier og hjelpetekster. | Behold avtalen først. Bruk delte kontroller og tydelige lenker. |
| Mål og hukommelse | Bruker kundesidens shell. | Arver fundamentet uten å endre tilgang eller lagring. |
| Tilbakemelding | Spørsmål med lik vekt og god plass, men lokal skrifttilpasning. | Behold spørsmålsvektingen. Del felt, fokus og feilfarge. |
| Belief practice | Egen nesten-lik grønn/gull-palett, egne radier, blå fokusring og annen fontstack. | Samme identitet og fargeroller. Behold programmets oppgavestruktur. |
| Unblock | Ny modul koblet inn 13. november. Delte programstiler, men egne lokale mål og valgkontroller. | Samme fundament, sentraliserte programutvidelser og synlige native valg. |
| Vilkår og personvern | Egen palettkopi, smal leseflate og lokale tekststørrelser. | Samme tokens, displaytittel og lesebredde. |
| Oppsummering på e-post | En særskilt brevmal med inline CSS er riktig for kanalen. | Del fargeverdier; behold tabeller, systemfont og brevets hierarki. |

## Retning

8&80 skal føles rolig, personlig og direkte. Tjenesten gir perspektiv og
husker hva en person sa. Den visuelle opplevelsen gjør det lett å forstå neste
avtale, uttrykke seg og endre egne valg.

Navnet skrives **8&80**. Merket beholder de ulike løkkestørrelsene og gullpunktet.
Bruk eksisterende SVG-er og `mascot()`; tegn ikke merket på nytt i komponenter.
Setningskasus, presise handlingsnavn og brukerens egne ord står sentralt.

## Tokens og ansvar

`services/voice/src/design-system/tokens.ts` er den autoritative kilden for
produktets tokens. CSS og JSON-eksport bygges fra denne filen.

| Lag | Ansvar |
| --- | --- |
| `palette` | De seks merkevarefargene. Endres som en merkevarebeslutning. |
| `themes` | Semantiske roller på lyst og mørkt: tekst, flate, handling, lenke, feltkant og feil. |
| `space` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 og 96 px ved standard tekstinnstilling. |
| `foundations` | Fontfamilier, tekstskala, linjehøyder, radier, bredder, målstørrelser og bevegelse. |

Komponenter bruker `var(--ink)`, `var(--accent)` og andre roller. Heksverdier
hører hjemme i tokens eller eksisterende merkevareillustrasjoner. `--line` er
en dekorativ skillelinje; `--control-border` avgrenser interaktive felt og har
minst 3:1 kontrast. `--bad` er en funksjonsfarge, ikke en syvende merkevarefarge.

Lyst tema bruker Paper/Pine og Green til lenker. Mørkt tema bruker Night/Chalk
og Gold til handlinger og lenker. Begge har egne verdier for hjelpetekst og feil.
Vanlige sider følger brukerens systeminnstilling, som før. Belief practice
beholder sitt eksplisitte mørke tema. `data-theme="light|dark"` kan brukes i
isolerte flater og forhåndsvisninger. Unngå å legge til et temavalg i produktet
før det finnes et brukerbehov for det.

## Typografi og layout

Fraunces brukes til hovedtittelen og ordmerket. Bricolage Grotesque brukes til
seksjoner, brødtekst og grensesnitt. Monospace er for kode i håndboken.

| Rolle | Standard | Bruk |
| --- | --- | --- |
| Display | 44–72 px / 500 / 1,06 | Hovedbudskap på landingssider |
| Sidetittel | 28–36 px / 500 / 1,15 | Første tittel i en oppgave |
| Seksjon | 21 px / 700 / 1,15 | Oppgavegrupper og deloverskrifter |
| Brødtekst | 18 px / 400 / 1,6 | Lesing og forklaringer |
| Kontrolltekst | 16 px | Knapper og etiketter |
| Hjelpetekst | 14 px | Metadata, støtte og kodeetiketter |

Fonter er lokalt lagret som variable WOFF2 med latinsk tegnsett inkludert norsk.
De to filene er til sammen omtrent 186 kB og bruker `font-display: swap`.
Lisens og byggoppskrift finnes i `brand/fonts/README.md`.

Bruk tre maksbredder: skjema **28 rem**, lesing **42 rem**, oversikt **72 rem**.
Mobil begynner med én kolonne og **20 px** sidemarg. Introduksjon og bestilling
kan bli to kolonner ved **55 rem**. I håndboken brytes sidemenyen ved **60 rem**.
Disse brytpunktene tilhører layouten; farger og komponenttilstander er felles.

Kontroller har **12 px** radius, paneler **24 px**. Knapper og felt er minst
**48 px** høye. Diskrete handlinger er minst **44 px** høye. Kompakte radiovalg
kan bli smalere på små skjermer; bevar høyde, luft og tydelig fokus.

## Bruk i nye sider

```ts
import { FOUNDATION_CSS, CONTROL_CSS, LAYOUT_CSS } from '../design-system/styles.ts';
import { button, field, notice } from '../design-system/components.ts';

const styles = FOUNDATION_CSS + CONTROL_CSS + LAYOUT_CSS;
const body = field({
  id: 'email', label: 'Email', type: 'email', autocomplete: 'email',
  hint: 'Your recap will be sent here.', required: true,
}) + button('Save my email');
const saved = notice('Your email is saved.');
```

Funksjonene escaper tekst og attributtverdier. `field()` knytter etikett,
hjelpetekst og eventuell feil til feltet og setter `aria-invalid`. Gi hvert
felt en unik ID. `button()` har primær, sekundær, rolig og destruktiv variant,
samt disabled og loading. Bruk `busyLabel()` sammen med eksisterende `BUSY` og
`MOTION` på skjemaer som skal vise arbeid ved innsending.

Delte native kontroller er det egentlige komponentgrunnlaget. De eksisterende
sidene beholder sin HTML, sine feltnavn, metoder og endepunkter og får felles
utseende gjennom `CONTROL_CSS`. De nye renderfunksjonene gjør det enklere å
bygge nye sider uten å kopiere markup.

`LAYOUT_CSS` tilbyr container, stack, cluster, grid, panel og lesebredde.
`pages.ts` samler komposisjonen for påmelding, konto, leseflater, tilbakemelding og
Belief practice og Unblock. Sidefilene eier innhold og oppgaver. `design:policy` hindrer at lokale
kopier av tekststørrelser, avstander og radier sniker seg inn igjen. Ikke legg til et
rammeverk for å bruke systemet.

## Tilstander og tilgjengelighet

Hver ny komponent vurderes i standard, hover, tastaturfokus, valgt, tom,
utilgjengelig, ventende og feiltilstand der de er relevante.

* Tekst, hjelpetekst, lenker og feil: minst **4,5:1** mot riktig flate.
* Feltkant og fokus: minst **3:1**. Fokus bruker temaets aksent med 3 px luft.
* Bruk `label`, `fieldset`, `legend`, native radio og `details/summary`.
* Vis feil i tekst ved riktig felt. Bevar innskrevne verdier.
* En lagret endring kan bruke `role="status"`; en handlingskrevende feil kan
  bruke `role="alert"`. Statiske instruksjoner skal ikke rope ved sidelasting.
* Skjemaer skal fungere uten JavaScript. Tidspilene er et tillegg til
  radiovalg og scrolling, ikke en forutsetning.
* `prefers-reduced-motion` stopper CSS-overganger og SVG-bevegelse. Endres innstillingen
  mens siden er åpen, går merket umiddelbart tilbake til hvile. Ved retur med nettleserens
  tilbakeknapp ryddes skjemaets ventetilstand, slik at det kan brukes igjen.
* Test ved **320, 375, 768 og 1280 px**, på begge temaer og med større tekst.

Automatiske kontrasttester verner rolleparene. Nettleserkontroll må fortsatt
vurdere faktisk oppsett, leserekkefølge og fokus; en token-test er ikke en
WCAG-sertifisering av hele tjenesten.

## E-post som egen kanal

Oppsummeringen er et brev. Den deler paletten, men bruker inline CSS,
presentasjonstabeller og systemfont. Den får ingen webfonter, nye knapper,
nyhetsbrevfooter eller animerte SVG-er. Eksisterende datakontroller og
kontaktkortpåminnelse beholdes. Se BRAND.md §9.

## Videre vekst

1. Begynn med en brukeroppgave og et eksisterende sidemønster.
2. Gjenbruk tokens og komponenter. Nye tjenester deler fundamentet.
3. Hvis noe mangler, beskriv behovet og relevante tilstander før det utvides.
4. Legg til et eksempel i håndboken og kontroller mobil, tastatur og begge temaer.
5. Bygg håndbok og eksporter på nytt, og oppdater dokumentasjonen samtidig.

Nye komponenter legges til når en konkret oppgave krever dem. Tabeller,
dialoger, navigasjonsutvidelser og datavisualiseringer trenger egne regler
når tjenesten faktisk tar dem i bruk. Den første versjonen legger et fundament
for dem og lar dagens kjerneoppgaver styre omfanget.

Endringer i tokens som påvirker alle flater krever visuell kontroll av minst
påmelding, konto, tilgang, hukommelse, tilbakemelding og Belief practice.
Produksjonspublisering er et eget steg etter gjennomgang av denne lokale versjonen.

## Automatiske kontroller og referansebilder

```sh
npx playwright install chromium webkit
npm run design:verify
```

`design:verify` starter en ny midlertidig Postgres-database og rydder den etterpå.
Postgres må ligge på PATH, eller binærmappen oppgis med `DESIGN_PG_BIN`.
Alternativt kan `TEST_DATABASE_URL` peke til en dedikert testdatabase. Testene oppretter
og tømmer egne skjemaer; bruk aldri en produksjonsdatabase. En eksplisitt testdatabase
som ikke virker, gir feil og kan ikke føre til at databasetestene hoppes over.

Kjøringen omfatter typekontroll, lint, tokenpolicy, eksportkontroll, hele testpakken
og nettlesertester. Nettlesertestene bruker den ekte HTTP-kontrolleren og testdatabasen,
med syntetiske profiler og lokale erstatninger for SMS, e-post, samtaler og betaling.
Tester og hjelpemekanismer ligger utenfor produksjonsrutene. Eksterne nettleserkall blokkeres.

Playwright er låst til en bestemt versjon. Referansebilder for påmelding, konto,
hukommelse, tilgang, tilbakemelding, Belief practice og Unblock ligger under
`tests/design/visual.spec.ts-snapshots/`, på 375 og 1280 px i begge temaer.
Håndboken, temaparet, de ferdige logoene og ikonene har egne bilder. Klokke, tidssone,
fontfiler og redusert bevegelse holdes faste for disse sammenligningene.

Ved en bevisst designendring:

```sh
npm run design:build
npm run design:update
DESIGN_VISUAL_ONLY=1 npm run design:test -- --project=chromium --grep @visual
```

Se gjennom de nye bildene før de lagres i Git. Oppdater bare på macOS 26 / Apple
Silicon, samme miljø som CI-jobben for visuell regresjon. Endret nettleser- eller
OS-versjon kan endre gjengivelsen og krever ny vurdering av referansebildene.
CI oppdaterer aldri bildene automatisk. Den laster opp forskjeller og spor ved feil.

GitHub-kontrollen kjører hele kodepakken og brukerreiser med Postgres, Chromium og
WebKit på Linux. En separat jobb sammenligner referansebilder på macOS 26.
`design:check` bygger eksportene i minnet og feiler på avvik; de ferdige filene kan
ikke gli fra kildekoden uten at kontrollen varsler.

## Verifikasjon av versjon 1.0

Kontrollert 13. november 2026, med grenen oppdatert til produktkoden i `7460176`:

* `npm run design:verify`: **987 kode- og databasetester bestått**, 0 feilet og
  0 hoppet over, mot en ny isolert Postgres-database.
* **61 nettlesertester bestått**: 28 brukerreise- og tilgjengelighetstester på
  Chromium og WebKit, samt 33 visuelle tester med til sammen 36 referansebilder.
* Axe kontrollerte 21 sider i begge temaer på begge nettlesermotorer, uten funn
  i de valgte WCAG A/AA-reglene. Tekstforstørrelse på 200 % ved 320 px, tastaturvalg,
  fokus ved feil, native skjemaer og endring av redusert bevegelse underveis bestod.
* Brukerreisene kontrollerte påmelding, SMS-verifisering, leveringsfeil, utløpte
  koder og lenker, treg innsending, tilbakeknapp, lagrede avtaler og mål,
  samtidige endringer, pause/gjenopptakelse og betalingsbekreftelse/avslutning.
* Unblocks valgkontroller er kontrollert som synlige native radio- og avkrysningsfelt.
  En datofølsom feil i modulens lokale simulering er rettet: en simulert lett samtale
  går nå forbi den annonserte kvelden, også over helger.
* Typekontroll, lint, tokenpolicy, eksportkontroll og `git diff --check` bestod.
  Logoer og ikoner ble kontrollert visuelt. Eksporttester kontrollerer filformater,
  PNG-størrelser, ICO-varianter, manifestadresser og at SVG-ordmerket har vektorbaner.

Mobilkontrollen bruker iPhone 13-emulering i WebKit, etter avtale. En fysisk iPhone
inngår ikke i denne verifikasjonen. Automatiske tilgjengelighetstester supplerer
visuell kontroll; de er ikke en full WCAG-sertifisering.

De fem ferdigstillingspunktene er gjennomført: felles sidestiler, databasebaserte
brukerreiser, mobil og tilgjengelighet, ferdige merkevarefiler og automatisert
regresjonskontroll. Produksjonsdata eller ekte meldinger, samtaler og betalinger
ble ikke brukt. Endringene ligger i `codex/design-system`, klare for gjennomgang
og publisering gjennom tjenestens vanlige releaseprosess.
