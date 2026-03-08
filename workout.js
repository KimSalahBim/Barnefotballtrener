// © 2026 Barnefotballtrener.no. All rights reserved.
// Barnefotballtrener - workout.js
// ================================================
// Bygg din treningsøkt: øvelse-for-øvelse, (valgfritt) oppmøte/spillere, gruppeinndeling og eksport.
// Designmål: integreres som en ny tab uten å påvirke Stripe/auth/kampdag/konkurranser.
//
// Viktig integrasjon:
// - Henter spillere fra window.players (publisert av core.js) + lytter på 'players:updated'.
// - Bruker delte algoritmer via window.Grouping (grouping.js), slik at Treningsgrupper/Laginndeling og denne modulen bruker samme logikk.

(function () {
  'use strict';

  console.log('[workout.js] loaded');

  // -------------------------
  // Utils
  // -------------------------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function isUseSkillEnabled() {
    const t = document.getElementById('skillToggle');
    return !!(t && t.checked);
  }


  function uuid(prefix = 'wo_') {
    return prefix + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  // -------------------------
  // Exercise catalog (Øvelsesbank)
  // -------------------------
  // "Drikkepause" skal ligge øverst (krav). Øvelser gruppert i kategorier.
  // Hver øvelse har: key, label, defaultMin, category, og valgfritt:
  // description, setup, steps[], coaching[], variations[], ages[], players, equipment, diagram{}
  const EXERCISES = [
    // ── DRIKKEPAUSE (alltid øverst, ingen info) ──
    { key: 'drink', label: 'Drikkepause', defaultMin: 2, category: 'special',
      nffCategory: 'pause', themes: [], nffPhases: [], learningGoals: [],
      intensity: 'none', hasOpposition: false },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🏃 OPPVARMING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'tag', label: 'Lek / Sisten', defaultMin: 8, category: 'oppvarming',
      ages: ['6-7','8-9','10-12','13-16'], players: '6-20',
      equipment: 'Kjegler til avgrensning, vester til fangere',
      nffCategory: 'sjef_over_ballen', themes: ['oppvarming_generell', 'leik'], nffPhases: ['noytral'],
      learningGoals: ['Retningsforandringer i fart', 'Lese rommet og reagere raskt'],
      intensity: 'high', hasOpposition: false,
      playerCount: { min: 6, max: 20 }, equipmentTags: ['kjegler', 'vester'],
      description: 'Klassisk sistenlek som oppvarming. Alle i bevegelse fra start. Barna kjenner reglene, så organisering tar minimalt tid. Perfekt for å få opp puls og engasjement.',
      setup: 'Avgrens et område på ca. 20x20 meter med kjegler. Gi 1-2 spillere vester — de er fangere.',
      steps: [
        'Fangerne (med vest) jakter de andre spillerne.',
        'Den som blir tatt, fryser på stedet med beina fra hverandre.',
        'Frie spillere kan redde frosne ved å krype mellom beina deres.',
        'Bytt fangere hvert 2. minutt.'
      ],
      coaching: [
        'Oppmuntre til retningsforandringer og finter',
        'Ros de som redder lagkamerater',
        'Gjør området mindre for mer intensitet'
      ],
      variations: [
        'Frostsisten: frosne spillere fryser med armene ut — fri dem ved å gå under armen',
        'Haletag: alle har et bånd i buksen — ta andres bånd uten å miste ditt eget'
      ],
      diagram: { width:220, height:160, field:'small', elements:[
        {type:'cone',x:20,y:20},{type:'cone',x:200,y:20},{type:'cone',x:20,y:140},{type:'cone',x:200,y:140},
        {type:'player',x:60,y:50,team:'b',label:'F'},{type:'player',x:160,y:100,team:'b',label:'F'},
        {type:'player',x:90,y:110,team:'a',label:''},{type:'player',x:140,y:40,team:'a',label:''},
        {type:'player',x:50,y:90,team:'a',label:''},{type:'player',x:170,y:65,team:'a',label:''},
        {type:'player',x:110,y:75,team:'a',label:''},
        {type:'arrow',from:[60,50],to:[90,80],style:'run'},{type:'arrow',from:[160,100],to:[140,70],style:'run'}
      ]}
    },
    {
      key: 'warm_ball', label: 'Ballmestring', defaultMin: 10, category: 'oppvarming',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-20',
      equipment: '1 ball per spiller, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['foering_dribling'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Kontroll på ballen med korte touch', 'Bruk ulike deler av foten', 'Løft blikket mens du fører ballen'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 20 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Individuell ballkontroll der hver spiller har sin egen ball. Føring med ulike deler av foten, vendinger, tempo-endringer. Bygger selvtillit og kontroll.',
      setup: 'Avgrens et område på ca. 15x15 meter. Alle spillere med egen ball inne i området.',
      steps: [
        'Spillerne fører ball fritt i området med korte touch.',
        'Treneren roper kommandoer: "Innsiden!", "Utsiden!", "Sålen!".',
        'På signal: stopp ball med sålen, vend og skift retning.',
        'Øk tempo gradvis. Avslutt med "hvem klarer flest vendinger på 30 sek?".'
      ],
      coaching: [
        'Ballen tett i foten, korte touch',
        'Løft blikket! Se etter rom og andre spillere',
        'Bruk begge føtter'
      ],
      variations: [
        'Kobling med nummersisten: trener roper tall, de med tallet blir fanger',
        'Legg til kjegler som slalåmløype'
      ],
      diagram: { width:220, height:160, field:'small', elements:[
        {type:'cone',x:20,y:20},{type:'cone',x:200,y:20},{type:'cone',x:20,y:140},{type:'cone',x:200,y:140},
        {type:'player',x:60,y:50,team:'a',label:''},{type:'ball',x:68,y:56},
        {type:'player',x:150,y:45,team:'a',label:''},{type:'ball',x:158,y:51},
        {type:'player',x:100,y:100,team:'a',label:''},{type:'ball',x:108,y:106},
        {type:'player',x:45,y:115,team:'a',label:''},{type:'ball',x:53,y:121},
        {type:'player',x:170,y:110,team:'a',label:''},{type:'ball',x:178,y:116},
        {type:'arrow',from:[60,50],to:[80,70],style:'run'},{type:'arrow',from:[150,45],to:[130,65],style:'run'}
      ]}
    },
    {
      key: 'rondo_easy', label: 'Rondo (lett)', defaultMin: 10, category: 'oppvarming',
      ages: ['8-9','10-12','13-16'], players: '5-8',
      equipment: '1 ball, kjegler til firkant',
      nffCategory: 'spille_med_og_mot', themes: ['pasning_samspill'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Gjør deg spillbar: avstand og vinkel til ballfører', 'Beveg deg etter pasning for å gi ny vinkel', 'Forsvarer: press på ballfører, steng pasningslinjer'],
      intensity: 'medium', hasOpposition: true,
      playerCount: { min: 5, max: 8 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Pasningsspill med overtall i firkant: 4 mot 1 eller 5 mot 2. Spillerne på utsiden holder ballen, den i midten prøver å vinne den. Kjerneøvelse i moderne fotball.',
      setup: 'Sett opp en firkant på ca. 6x6 meter (8x8 for 5v2). Spillere på utsiden, 1-2 i midten.',
      steps: [
        'Spillerne på utsiden passer ballen med maks 2 touch.',
        'Spilleren i midten jager ballen og prøver å ta den.',
        'Ved erobring: den som mistet ballen bytter inn i midten.',
        'Tell antall pasninger i strekk — sett rekord!'
      ],
      coaching: [
        'Åpne kroppen mot banen, ikke bare mot ballen',
        'Spill med innsiden for presisjon',
        'Beveg deg etter pasning for å gi ny vinkel',
        'Forsvareren: press på ballfører, steng pasningslinjer'
      ],
      variations: [
        '4v1 for yngre/lavere nivå, 5v2 for eldre/høyere nivå',
        'Kun 1 touch for mer intensitet'
      ],
      diagram: { width:220, height:170, field:'none', elements:[
        {type:'cone',x:50,y:25},{type:'cone',x:170,y:25},{type:'cone',x:170,y:145},{type:'cone',x:50,y:145},
        {type:'player',x:110,y:20,team:'a',label:'A'},{type:'player',x:175,y:85,team:'a',label:'B'},
        {type:'player',x:110,y:150,team:'a',label:'C'},{type:'player',x:45,y:85,team:'a',label:'D'},
        {type:'player',x:110,y:85,team:'b',label:'X'},
        {type:'ball',x:120,y:16},
        {type:'arrow',from:[110,20],to:[175,85],style:'pass'},{type:'arrow',from:[118,85],to:[165,85],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ⚽ TEKNIKK
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'driving', label: 'Føring av ball', defaultMin: 10, category: 'teknikk',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-16',
      equipment: '1 ball per spiller, 6-10 kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['foering_dribling'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Ballen tett i foten med korte touch', 'Løft blikket mellom kjeglene', 'Bruk begge føtter og ulike deler av foten'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 16 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Spillerne fører ballen gjennom en kjegleløype med ulike deler av foten. Trener kontroll i fart og evnen til å holde ballen tett mens man beveger seg fremover.',
      setup: 'Sett opp 6-10 kjegler i sikk-sakk med 2-3 meters mellomrom. 2-4 spillere starter samtidig i parallelle løyper.',
      steps: [
        'Før ballen med innsiden gjennom hele løypen.',
        'Tilbake med utsiden av foten.',
        'Tredje runde: veksle innside/utside rundt hver kjegle.',
        'Fjerde runde: fri føring med maks fart!'
      ],
      coaching: [
        'Korte touch, ballen nær foten',
        'Blikket opp mellom kjeglene',
        'Bruk begge føtter',
        'Press tempoet gradvis'
      ],
      variations: [
        'Siste kjegle = skudd på mål for motivasjon',
        'Stafett mellom to lag for konkurranse'
      ],
      diagram: { width:220, height:120, field:'none', elements:[
        {type:'cone',x:30,y:60},{type:'cone',x:65,y:35},{type:'cone',x:100,y:60},
        {type:'cone',x:135,y:35},{type:'cone',x:170,y:60},{type:'cone',x:200,y:35},
        {type:'player',x:15,y:60,team:'a',label:''},{type:'ball',x:23,y:66},
        {type:'arrow',from:[23,66],to:[60,40],style:'run'},{type:'arrow',from:[60,40],to:[95,65],style:'run'},
        {type:'arrow',from:[95,65],to:[130,40],style:'run'},{type:'arrow',from:[130,40],to:[165,65],style:'run'}
      ]}
    },
    {
      key: 'pass_pair', label: 'Pasning parvis', defaultMin: 10, category: 'teknikk',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-20',
      equipment: '1 ball per par, kjegler som markering',
      nffCategory: 'sjef_over_ballen', themes: ['pasning_samspill'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Støttefoten peker mot mottaker', 'Treffe midt på ballen med innsiden', 'Åpent mottak: demp og legg klar i én bevegelse'],
      suggestedGroupSize: 2, intensity: 'low', hasOpposition: false,
      playerCount: { min: 4, max: 20 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Grunnøvelsen i pasningsspill. To og to spillere sender ballen til hverandre med innsidetouch. Fokus på teknikk, mottak og presisjon.',
      setup: 'Spillerne stiller seg parvis med 5-10 meters avstand (kortere for yngre). Hvert par har én ball.',
      steps: [
        'Spiller A sender innsidepasning til B.',
        'B tar imot med innsiden (demper ballen), legger til rette.',
        'B passer tilbake til A.',
        'Etter 2 min: øk avstand. Etter 4 min: bruk kun venstre fot.'
      ],
      coaching: [
        'Støttefoten peker mot mottakeren',
        'Treffe midt på ballen med innsiden',
        'Åpent mottak: demp og legg klar i én bevegelse',
        'Kommuniser! Rop "her!" eller bruk navn'
      ],
      variations: [
        'Mottak med høyre, pass med venstre (og omvendt)',
        'Legg til "vegg": en tredje spiller i midten som spiller videre'
      ],
      diagram: { width:220, height:100, field:'none', elements:[
        {type:'player',x:40,y:50,team:'a',label:'A'},{type:'player',x:180,y:50,team:'a',label:'B'},
        {type:'ball',x:100,y:45},
        {type:'arrow',from:[50,50],to:[170,50],style:'pass'},
        {type:'cone',x:40,y:28},{type:'cone',x:180,y:28}
      ]}
    },
    {
      key: 'pass_move', label: 'Pasning og bevegelse', defaultMin: 10, category: 'teknikk',
      ages: ['8-9','10-12','13-16'], players: '6-12',
      equipment: '2-3 baller, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['pasning_samspill'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Beveg deg etter pasning (slå og gå)', 'Se deg rundt FØR ballen kommer', 'Førsteberøring legger ballen klar for neste pasning'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 6, max: 12 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Etter å ha spilt pasning, beveger spilleren seg til ny posisjon for å motta igjen. Trener det viktigste prinsippet i lagspill: spill og flytt deg!',
      setup: 'Sett opp en trekant med kjegler (8-10m mellom). Spillere fordelt på hjørnene, ball starter hos én.',
      steps: [
        'A passer til B og løper mot Bs posisjon.',
        'B tar imot, passer til C, og løper mot Cs posisjon.',
        'C tar imot, passer til neste, og følger ballen.',
        'Hold flyten gående. Ball og spillere sirkulerer hele tiden.'
      ],
      coaching: [
        'Beveg deg MED EN GANG etter pasning',
        'Mottaker: se deg rundt FØR ballen kommer',
        'Tempo på pasningene — trill ballen med fart',
        'Førstekontakt legger ballen klar for neste pasning'
      ],
      variations: [
        'To baller i omløp samtidig for mer intensitet',
        'Legg til en forsvarer i midten (halvt rondo-prinsipp)'
      ],
      diagram: { width:220, height:170, field:'none', elements:[
        {type:'cone',x:110,y:20},{type:'cone',x:190,y:140},{type:'cone',x:30,y:140},
        {type:'player',x:110,y:28,team:'a',label:'A'},{type:'player',x:186,y:132,team:'a',label:'B'},
        {type:'player',x:34,y:132,team:'a',label:'C'},
        {type:'ball',x:120,y:24},
        {type:'arrow',from:[110,28],to:[186,132],style:'pass'},
        {type:'arrow',from:[115,38],to:[180,125],style:'run'}
      ]}
    },
    {
      key: 'pass_square', label: 'Pasningsfirkant', defaultMin: 12, category: 'teknikk',
      ages: ['8-9','10-12','13-16'], players: '4-12',
      equipment: 'Kjegler, 1-3 baller',
      nffCategory: 'sjef_over_ballen', themes: ['pasning_samspill', 'vendinger_mottak'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Orientert førsteberøring: se dit du skal spille', 'Førstetouch legger ballen klar for pasning', 'Åpne kroppen før mottak'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 12 }, equipmentTags: ['kjegler', 'ball'],
      description: 'Klassisk pasningsøvelse. Spillerne står i en firkant og passer ballen rundt med mottak, vending og videre pasning. Trener orientering, presisjon og å løfte blikket.',
      setup: 'Fire kjegler i firkant, ca. 8x8 meter. Én spiller ved hvert hjørne (flere spillere: 2-3 per hjørne i kø).',
      steps: [
        'A passer til B med innsiden og løper etter ballen til Bs plass.',
        'B tar imot, vender med ball, og passer videre til C.',
        'Mønsteret fortsetter rundt firkanten.',
        'Bytt retning hvert 2. minutt!'
      ],
      coaching: [
        'Åpne kroppen før mottak — se dit du skal spille',
        'Førstetouch legger ballen klar for pasning',
        'Innsiden for kort, driv for lang distanse',
        'Ballen skal aldri ligge stille'
      ],
      variations: [
        'Legg til en forsvarer i midten (rondo-variant)',
        'Krev kun 2 touch: mottak + pasning'
      ],
      diagram: { width:220, height:170, field:'none', elements:[
        {type:'cone',x:40,y:25},{type:'cone',x:180,y:25},{type:'cone',x:180,y:145},{type:'cone',x:40,y:145},
        {type:'player',x:40,y:33,team:'a',label:'A'},{type:'player',x:180,y:33,team:'a',label:'B'},
        {type:'player',x:180,y:137,team:'a',label:'C'},{type:'player',x:40,y:137,team:'a',label:'D'},
        {type:'ball',x:55,y:30},
        {type:'arrow',from:[50,33],to:[170,33],style:'pass'},
        {type:'arrow',from:[180,41],to:[180,130],style:'pass'},
        {type:'arrow',from:[55,43],to:[168,38],style:'run'}
      ]}
    },
    {
      key: 'dribble', label: 'Dribling 1 mot 1', defaultMin: 10, category: 'teknikk',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-16',
      equipment: 'Baller, småmål eller kjegler, vester',
      nffCategory: 'spille_med_og_mot', themes: ['foering_dribling', '1v1_duell'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Angriper: brems opp foran forsvarer, bruk finter', 'Forsvarer: stå sidelengs, vær tålmodig', 'Lav tyngdepunkt for rask retningsendring'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: true,
      playerCount: { min: 4, max: 16 }, equipmentTags: ['ball', 'smaamaal', 'kjegler', 'vester'],
      description: 'Én angriper mot én forsvarer. Angriperen prøver å drible forbi og score. Ren duelltrening som bygger selvtillit og mot til å ta på seg spillere.',
      setup: 'Liten bane (10x15m) med to kjeglemål. Spillerne i to køer, én angriper og én forsvarer per runde.',
      steps: [
        'Angriperen starter med ball fra enden av banen.',
        'Forsvareren starter fra midtlinjen og møter angriperen.',
        'Angriperen prøver å drible forbi og score i småmål.',
        'Bytt rolle etter hver runde.'
      ],
      coaching: [
        'Angriper: løp MOT forsvareren, brems i siste øyeblikk',
        'Bruk finter og kroppsvendinger for å lure',
        'Forsvarer: stå sidelengs, tving angriperen dit du vil',
        'Ikke stup inn — vær tålmodig!'
      ],
      variations: [
        '2v1 for å trene samarbeid i overtall',
        'Tidsbegrensning: 8 sekunder per forsøk'
      ],
      diagram: { width:220, height:160, field:'none', elements:[
        {type:'goal',x:85,y:5,w:50,h:12},
        {type:'player',x:110,y:55,team:'b',label:'F'},{type:'player',x:110,y:120,team:'a',label:'A'},
        {type:'ball',x:118,y:126},
        {type:'arrow',from:[110,120],to:[110,65],style:'run'},
        {type:'cone',x:75,y:55},{type:'cone',x:145,y:55},
        {type:'goal',x:85,y:143,w:50,h:12}
      ]}
    },
    {
      key: 'turn', label: 'Vendinger', defaultMin: 10, category: 'teknikk',
      ages: ['8-9','10-12','13-16'], players: '4-16',
      equipment: '1 ball per spiller, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['vendinger_mottak', 'foering_dribling'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Brems ned FØR vendingen, akseler ETTER', 'Bruk kroppen til å skjerme ballen', 'Se deg rundt i vendingsøyeblikket'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 16 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Trening av ulike vendeteknikker: Cruyff-vending, innsidevending, utsidedraging. Evnen til å snu med ball er avgjørende for å komme ut av press.',
      setup: 'Spillerne fører ball mot en kjegle, utfører vending, og fører ball tilbake. 3-4 parallelle stasjoner.',
      steps: [
        'Før ballen mot kjeglen i rolig tempo.',
        'Ved kjeglen: utfør vendeteknikk (trener viser hvilken).',
        'Akseler ut av vendingen og før ball tilbake.',
        'Roter mellom teknikkene: innsidevending, Cruyff, sålevending.'
      ],
      coaching: [
        'Brems ned FØR vendingen, akseler ETTER',
        'Bruk kroppen til å skjerme ballen',
        'Se deg rundt i vendingsøyeblikket',
        'Øv begge retninger!'
      ],
      variations: [
        'Legg til en passiv forsvarer som presser lett',
        'Vend og slå pasning til neste i køen'
      ],
      diagram: { width:220, height:110, field:'none', elements:[
        {type:'player',x:30,y:45,team:'a',label:''},{type:'ball',x:40,y:50},
        {type:'cone',x:150,y:45},
        {type:'arrow',from:[40,45],to:[140,45],style:'run'},
        {type:'arrow',from:[150,55],to:[50,60],style:'run'},
        {type:'player',x:30,y:85,team:'a',label:''},{type:'cone',x:150,y:85}
      ]}
    },
    {
      key: 'receive_turn', label: 'Mottak og vending', defaultMin: 10, category: 'teknikk',
      ages: ['8-9','10-12','13-16'], players: '6-12',
      equipment: '1 ball per par, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['vendinger_mottak', 'pasning_samspill'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Sjekk over skulderen FØR ballen kommer', 'Åpne kroppen mot dit du vil vende', 'Førstetouch i retning du skal spille'],
      suggestedGroupSize: 2, intensity: 'medium', hasOpposition: false,
      playerCount: { min: 6, max: 12 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Spilleren mottar pasning med ryggen mot spilleretning, vender med førstetouch, og spiller videre. Trener orientert førstetouch — en nøkkelferdighet.',
      setup: 'Spillerne i par, 10m avstand. Én kjegle bak mottakeren (representerer retningen å vende mot).',
      steps: [
        'A passer til B som har ryggen mot Bs kjegle.',
        'B tar imot med åpent mottak: vender kroppen og ballen i én bevegelse.',
        'B fører ballen forbi kjeglen og passer tilbake til A.',
        'Bytt roller etter 5 repetisjoner.'
      ],
      coaching: [
        'Sjekk over skulderen FØR ballen kommer',
        'Åpne kroppen mot dit du vil vende',
        'Førstetouch i retning du skal spille',
        'Bruk utsiden av foten for å ta med ballen rundt'
      ],
      variations: [
        'Legg til en passiv forsvarer bak mottakeren',
        'Mottak-vending-skudd: avslutt på mål etter vending'
      ],
      diagram: { width:220, height:120, field:'none', elements:[
        {type:'player',x:35,y:60,team:'a',label:'A'},{type:'player',x:140,y:60,team:'a',label:'B'},
        {type:'cone',x:195,y:60},
        {type:'ball',x:85,y:55},
        {type:'arrow',from:[45,60],to:[130,60],style:'pass'},
        {type:'arrow',from:[145,50],to:[190,40],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🎯 AVSLUTNING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'shot', label: 'Skudd på mål', defaultMin: 12, category: 'avslutning',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-14',
      equipment: 'Mål (stort eller småmål), baller, kjegler',
      nffCategory: 'scoringstrening', themes: ['avslutning'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Plassering foran kraft: sikte lavt i hjørnene', 'Støttefot peker mot mål', 'Følg opp skuddet, vær klar for retur'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 14 }, equipmentTags: ['maal', 'ball', 'kjegler'],
      description: 'Avslutninger fra ulike posisjoner. Fokus på plassering framfor kraft. Alle barn elsker å skyte på mål — la dem gjøre det mye!',
      setup: 'Mål med keeper (eller åpent med kjegler). Spillere i kø ca. 12-16m fra mål. Baller klare på rekke.',
      steps: [
        'Spilleren fører ball mot mål fra sentralt.',
        'Avslutt på mål fra ca. 10-12 meter.',
        'Neste runde: skudd fra venstre side.',
        'Tredje runde: skudd fra høyre side.',
        'Fjerde runde: mottar pasning fra siden og avslutter direkte.'
      ],
      coaching: [
        'Plassering slår kraft — sikte lavt i hjørnene',
        'Støttefot peker mot mål',
        'Treffe midt/øvre del av ballen for lavt skudd',
        'Følg opp skuddet — vær klar for retur!'
      ],
      variations: [
        'Konkurranse: hvem scorer flest av 5 forsøk?',
        'Legg til en forsvarer som presser bakfra'
      ],
      diagram: { width:220, height:150, field:'none', elements:[
        {type:'goal',x:70,y:5,w:80,h:16},{type:'keeper',x:110,y:18},
        {type:'player',x:110,y:110,team:'a',label:''},{type:'ball',x:118,y:105},
        {type:'arrow',from:[118,105],to:[110,25],style:'shot'},
        {type:'player',x:70,y:110,team:'a',label:''},{type:'player',x:150,y:110,team:'a',label:''}
      ]}
    },
    {
      key: 'shot_race', label: 'Skuddstafett', defaultMin: 10, category: 'avslutning',
      ages: ['6-7','8-9','10-12','13-16'], players: '6-16',
      equipment: 'Mål, baller, kjegler',
      nffCategory: 'scoringstrening', themes: ['avslutning', 'foering_dribling'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Fart OG kontroll gjennom kjeglene', 'Ro deg ned foran mål: presisjon over panikkskudd'],
      intensity: 'high', hasOpposition: false,
      playerCount: { min: 6, max: 16 }, equipmentTags: ['maal', 'ball', 'kjegler'],
      description: 'To lag i stafett. Før ball gjennom kjegler og avslutt på mål. Kombinerer avslutning med fart og konkurranse — garantert engasjement!',
      setup: 'To parallelle kjegleløyper mot ett mål. Spillerne delt i to lag i kø bak startlinjen.',
      steps: [
        'Første spiller i hvert lag fører ball gjennom kjeglene.',
        'Avslutt med skudd på mål.',
        'Løp tilbake og gi high five til neste i køen.',
        'Laget som scorer flest mål totalt vinner!'
      ],
      coaching: [
        'Fart OG kontroll gjennom kjeglene',
        'Ro deg ned foran mål — presisjon over panikkskudd',
        'Hei på lagkameratene!'
      ],
      variations: [
        'Legg til en vending eller passningsvegg før avslutning',
        'Keeper i mål for ekstra utfordring'
      ],
      diagram: { width:220, height:160, field:'none', elements:[
        {type:'goal',x:70,y:3,w:80,h:14},
        {type:'cone',x:55,y:55},{type:'cone',x:75,y:80},{type:'cone',x:55,y:105},
        {type:'player',x:65,y:140,team:'a',label:''},{type:'ball',x:73,y:136},
        {type:'cone',x:145,y:55},{type:'cone',x:165,y:80},{type:'cone',x:145,y:105},
        {type:'player',x:155,y:140,team:'b',label:''},{type:'ball',x:163,y:136},
        {type:'arrow',from:[65,135],to:[65,25],style:'run'},
        {type:'arrow',from:[155,135],to:[155,25],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ⚔️ SPILL MED MOTSTAND
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: '1v1', label: '1 mot 1', defaultMin: 10, category: 'spill_m_motstand',
      ages: ['6-7','8-9','10-12','13-16'], players: '4-16',
      equipment: 'Småmål eller kjegler, baller, vester',
      nffCategory: 'spille_med_og_mot', themes: ['1v1_duell', 'forsvarsspill'], nffPhases: ['angrep_avslutning', 'forsvar_vinne_ball'],
      learningGoals: ['Angriper: tøff mot forsvarer, bruk finter og fart', 'Forsvarer: tving angriperen dit DU vil, stå på tå', 'Aldri gi opp, kjemp om ballen!'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: true,
      playerCount: { min: 4, max: 16 }, equipmentTags: ['smaamaal', 'kjegler', 'ball', 'vester'],
      description: 'Ren duelltrening på liten bane med småmål. Én angriper mot én forsvarer. Bygger ferdighet i å ta på seg en spiller og å forsvare.',
      setup: 'Liten bane 8x12m med kjeglemål i hver ende. Par stiller opp ved hver sin baselinje.',
      steps: [
        'Trener spiller ball inn i banen.',
        'Begge løper etter ballen — den som når først er angriper.',
        'Spill 1 mot 1 til mål scores eller ballen går ut.',
        'Ny ball fra trener, nye spillere.'
      ],
      coaching: [
        'Angriper: tøff mot forsvareren, bruk finter',
        'Forsvarer: tving angriperen dit DU vil, stå på tå',
        'Lav tyngdepunkt for rask retningsendring',
        'Aldri gi opp!'
      ],
      variations: [
        'Angriper har 2 mål å velge mellom (må lese forsvareren)',
        '3-sekunders tidskrav for raskere avgjørelser'
      ],
      diagram: { width:220, height:150, field:'none', elements:[
        {type:'goal',x:90,y:5,w:40,h:10},{type:'goal',x:90,y:135,w:40,h:10},
        {type:'player',x:95,y:60,team:'a',label:'A'},{type:'player',x:125,y:85,team:'b',label:'F'},
        {type:'ball',x:103,y:66},
        {type:'arrow',from:[95,60],to:[110,25],style:'run'},
        {type:'cone',x:40,y:5},{type:'cone',x:40,y:145},{type:'cone',x:180,y:5},{type:'cone',x:180,y:145}
      ]}
    },
    {
      key: '2v1', label: '2 mot 1', defaultMin: 10, category: 'spill_m_motstand',
      ages: ['8-9','10-12','13-16'], players: '6-12',
      equipment: 'Småmål eller kjegler, baller',
      nffCategory: 'spille_med_og_mot', themes: ['samarbeidsspill', 'avslutning'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Angriper med ball: trekk forsvarer FØR pasning', 'Angriper uten ball: hold avstand og vinkel, vær spillbar', 'Timing: spill pasning i riktig øyeblikk'],
      suggestedGroupSize: 3, intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 12 }, equipmentTags: ['smaamaal', 'kjegler', 'ball'],
      description: 'To angripere mot én forsvarer. Trener den viktigste beslutningen i fotball: når skal jeg drible, og når skal jeg spille pasning?',
      setup: 'Bane 10x15m. Mål i ene enden. Forsvareren fra midten, angriperne fra andre enden.',
      steps: [
        'Angriperparet starter med ball fra baselinjen.',
        'Forsvareren starter fra midtlinjen og løper mot angriperne.',
        'Angriperne samarbeider for å passere forsvareren og score.',
        'Bytt roller: forsvareren går inn i angriperpar.'
      ],
      coaching: [
        'Angriper med ball: dra forsvareren mot deg FØR du passer',
        'Angriper uten ball: hold avstand og vinkel, vær spillbar',
        'Forsvarer: tving ballfører til én side, steng pasningslinjen',
        'Timing er alt — pass i riktig øyeblikk!'
      ],
      variations: [
        '3v2 for mer kompleksitet',
        'To mål: angriperne velger hvilket mål de angriper'
      ],
      diagram: { width:220, height:160, field:'none', elements:[
        {type:'goal',x:80,y:3,w:60,h:14},
        {type:'player',x:80,y:70,team:'b',label:'F'},
        {type:'player',x:80,y:130,team:'a',label:'A'},{type:'player',x:150,y:130,team:'a',label:'B'},
        {type:'ball',x:88,y:124},
        {type:'arrow',from:[80,130],to:[80,80],style:'run'},
        {type:'arrow',from:[88,124],to:[148,90],style:'pass'},
        {type:'arrow',from:[150,130],to:[150,80],style:'run'}
      ]}
    },
    {
      key: '3v2', label: '3 mot 2', defaultMin: 12, category: 'spill_m_motstand',
      ages: ['8-9','10-12','13-16'], players: '8-15',
      equipment: 'Mål, baller, vester',
      nffCategory: 'spille_med_og_mot', themes: ['samarbeidsspill', 'avslutning'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Trekantformasjon: bred, ikke i linje', 'Spiller med ball: trekk forsvarer, spill videre', 'Avslutt! Ikke overspill, ta sjansen når du har den'],
      suggestedGroupSize: 5, intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 15 }, equipmentTags: ['maal', 'ball', 'vester'],
      description: 'Tre angripere mot to forsvarere. Trener trekantspill, støtteløp og pasning i rom. Kampnært og utviklende.',
      setup: 'Bane 15x20m med mål. Forsvarerne fra midten, angriperne fra baselinjen.',
      steps: [
        'Tre angripere starter med ball fra baselinjen.',
        'To forsvarere møter fra midtlinjen.',
        'Angriperne samarbeider for å skape rom og score.',
        'Avslutt innen 10 sekunder — skaper tempo.'
      ],
      coaching: [
        'Trekantformasjon: bred, ikke i linje',
        'Spiller med ball: trekk en forsvarer, spill videre',
        'Spillere uten ball: støtteløp og diagonale bevegelser',
        'Avslutt! Ikke overspill — ta sjansen når du har den'
      ],
      variations: [
        'Forsvarerne konter på kjeglemål ved ballvinning',
        'Legg til keeper for mer realisme'
      ],
      diagram: { width:220, height:160, field:'none', elements:[
        {type:'goal',x:70,y:3,w:80,h:14},
        {type:'player',x:85,y:65,team:'b',label:'F'},{type:'player',x:135,y:65,team:'b',label:'F'},
        {type:'player',x:60,y:130,team:'a',label:'A'},{type:'player',x:110,y:140,team:'a',label:'B'},
        {type:'player',x:160,y:130,team:'a',label:'C'},{type:'ball',x:118,y:134},
        {type:'arrow',from:[118,134],to:[65,95],style:'pass'},
        {type:'arrow',from:[60,130],to:[60,80],style:'run'},
        {type:'arrow',from:[160,130],to:[160,80],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🏟️ SMÅLAGSSPILL
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'ssg', label: 'Smålagsspill', defaultMin: 18, category: 'smalagsspill',
      ages: ['6-7','8-9','10-12','13-16'], players: '6-16',
      equipment: 'Mål (2 stk), vester, baller, kjegler til bane',
      nffCategory: 'smalagsspill', themes: ['spillforstaelse'], nffPhases: ['angrep_fremover', 'angrep_avslutning', 'forsvar_vinne_ball', 'forsvar_hindre_maal'],
      learningGoals: ['Spre dere! Ikke alle rundt ballen', 'Snakk sammen: rop på ballen, gi beskjed', 'Etter ballvinning: se framover først'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 16 }, equipmentTags: ['maal', 'vester', 'ball', 'kjegler'],
      description: 'Kjerneøvelsen i barnefotball. Minimum 50% av økten bør være smålagsspill. 3v3, 4v4 eller 5v5 på tilpasset bane gir mest mulig ballkontakt i kamplike situasjoner.',
      setup: 'Tilpass banestørrelse (3v3: 20x25m, 5v5: 30x40m). To mål, vester for lagdeling.',
      steps: [
        'Del inn i to lag med vester.',
        'Vanlige regler, innkast/innspark ved sidelinje.',
        'Spill perioder på 4-6 minutter, kort pause, nye lag.',
        'Trener kan stoppe kort for å veilede, men la spillet flyte!'
      ],
      coaching: [
        'Spre dere! Ikke alle rundt ballen',
        'Snakk sammen — rop på ballen, gi beskjed',
        'Etter ballvinning: se framover først!',
        'La barna prøve og feile — ros innsats, ikke bare mål'
      ],
      variations: [
        'Jokere: 1-2 spillere alltid med angripende lag',
        'Flere mål for mer rom og gøy'
      ],
      diagram: { width:240, height:160, field:'half', elements:[
        {type:'goal',x:5,y:55,w:12,h:50,vertical:true},{type:'goal',x:223,y:55,w:12,h:50,vertical:true},
        {type:'player',x:50,y:45,team:'a',label:''},{type:'player',x:50,y:115,team:'a',label:''},
        {type:'player',x:95,y:80,team:'a',label:''},
        {type:'player',x:145,y:45,team:'b',label:''},{type:'player',x:145,y:115,team:'b',label:''},
        {type:'player',x:190,y:80,team:'b',label:''},{type:'ball',x:100,y:74}
      ]}
    },
    {
      key: 'possession', label: 'Ballbesittelse', defaultMin: 12, category: 'smalagsspill',
      ages: ['8-9','10-12','13-16'], players: '7-15',
      equipment: 'Vester, baller, kjegler til bane',
      nffCategory: 'smalagsspill', themes: ['pasning_samspill', 'forsvarsspill'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Gjør deg spillbar: avstand og vinkel til ballfører', 'Se opp før du får ballen: orienter deg', 'Forsvar: press sammen, steng midten'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 7, max: 15 }, equipmentTags: ['vester', 'ball', 'kjegler'],
      description: 'Hold ballen i laget med overtall (f.eks. 4v2 med jokere). Trener pasningsspill under press, orientering og bevegelse for å bli spillbar.',
      setup: 'Avgrens et område (12x12 til 20x20m). Del inn i to lag pluss 1-2 jokere som alltid er med ballførende lag.',
      steps: [
        'Laget med ball holder den så lenge som mulig.',
        'Jokerne spiller med det ballførende laget (overtall).',
        'Forsvarerne vinner ball = bytt!',
        'Tell pasninger i strekk — hvem klarer 10?'
      ],
      coaching: [
        'Gjør deg spillbar: avstand og vinkel til ballfører',
        'Jokere: beveg deg, ikke stå stille!',
        'Se opp før du får ballen — orienter deg',
        'Forsvar: press sammen, steng midten'
      ],
      variations: [
        'Uten jokere for lik kamp',
        'Score ved å spille ballen fra side til side'
      ],
      diagram: { width:220, height:170, field:'small', elements:[
        {type:'cone',x:20,y:15},{type:'cone',x:200,y:15},{type:'cone',x:20,y:155},{type:'cone',x:200,y:155},
        {type:'player',x:55,y:40,team:'a',label:''},{type:'player',x:165,y:40,team:'a',label:''},
        {type:'player',x:55,y:130,team:'a',label:''},{type:'player',x:165,y:130,team:'a',label:''},
        {type:'player',x:110,y:85,team:'neutral',label:'J'},
        {type:'player',x:90,y:70,team:'b',label:''},{type:'player',x:130,y:100,team:'b',label:''},
        {type:'ball',x:63,y:36},{type:'arrow',from:[55,40],to:[105,80],style:'pass'}
      ]}
    },
    {
      key: 'game_activity', label: 'Fri spillaktivitet', defaultMin: 18, category: 'smalagsspill',
      ages: ['6-7','8-9','10-12','13-16'], players: '6-20',
      equipment: 'Mål, baller, vester',
      nffCategory: 'smalagsspill', themes: ['spillforstaelse', 'leik'], nffPhases: ['angrep_fremover', 'angrep_avslutning', 'forsvar_vinne_ball', 'forsvar_hindre_maal'],
      learningGoals: ['La barna løse problemene selv', 'Ros samarbeid og innsats, ikke bare scoring'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 20 }, equipmentTags: ['maal', 'ball', 'vester'],
      description: 'Ustrukturert spill der barna styrer selv. Treneren observerer og heier, men griper minimalt inn. Gir eierskap, kreativitet og ren fotballglede.',
      setup: 'Tilpasset bane med mål. Del inn i lag (kan være ujevne). Minimalt med regler.',
      steps: [
        'Del inn i lag. Forklar: "Nå er det match!".',
        'Spillerne styrer selv — innkast, mål, igangsettinger.',
        'Treneren observerer og heier, griper minimalt inn.',
        'Bytt lag halvveis for variasjon.'
      ],
      coaching: [
        'Tren deg i å holde igjen — la barna løse problemene selv',
        'Ros samarbeid og innsats, ikke bare scoring',
        'Gå gjerne inn som spiller selv om det trengs',
        'Sørg for at alle er involvert'
      ],
      variations: [
        'Alle må touche ballen før scoring teller',
        'Spill uten keeper for mer scoring'
      ],
      diagram: { width:240, height:160, field:'half', elements:[
        {type:'goal',x:5,y:55,w:12,h:50,vertical:true},{type:'goal',x:223,y:55,w:12,h:50,vertical:true},
        {type:'player',x:35,y:35,team:'a',label:''},{type:'player',x:90,y:110,team:'a',label:''},
        {type:'player',x:60,y:75,team:'a',label:''},
        {type:'player',x:160,y:50,team:'b',label:''},{type:'player',x:190,y:105,team:'b',label:''},
        {type:'player',x:125,y:85,team:'b',label:''},
        {type:'ball',x:88,y:70},
        {type:'arrow',from:[60,75],to:[85,70],style:'run'},
        {type:'arrow',from:[125,85],to:[92,72],style:'run'},
        {type:'arrow',from:[160,50],to:[140,62],style:'run'}
      ]}
    },
    {
      key: 'square_game', label: 'Spill i soner', defaultMin: 12, category: 'smalagsspill',
      ages: ['10-12','13-16'], players: '8-16',
      equipment: 'Mål, vester, kjegler, baller',
      nffCategory: 'smalagsspill', themes: ['spillforstaelse', 'romforstaelse'], nffPhases: ['angrep_fremover', 'angrep_avslutning', 'forsvar_vinne_ball'],
      learningGoals: ['Se etter rom i neste sone FØR du mottar', 'Bruk bredden, ikke bare gjennom midten', 'Forsvar: kontroller midtsonen, press som lag'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['maal', 'vester', 'kjegler', 'ball'],
      description: 'Spill i avgrenset område med soneoppgaver. F.eks. må ballen innom midtsonen før scoring. Trener romforståelse og taktisk tenkning.',
      setup: 'Del en halvbane i 2-3 soner med kjegler. Mål i hver ende. Tydelig markering mellom sonene.',
      steps: [
        'Vanlig spill, men ballen MÅ ha vært i midtsonen før scoring.',
        'Spill i perioder på 5 minutter.',
        'Varier soneregelen underveis.',
        'F.eks.: "score kun etter innlegg fra ytterkanten".'
      ],
      coaching: [
        'Se etter rom i neste sone FØR du mottar',
        'Bruk bredden — ikke spill gjennom midten hele tiden',
        'Forsvar: kontroller midtsonen, press som lag',
        'Beveg dere mellom sonene for å skape rom'
      ],
      variations: [
        'Legg til jokere i midtsonen',
        'Tidsbegrensning: 20 sek etter sonegjennomspill'
      ],
      diagram: { width:240, height:160, field:'half', elements:[
        {type:'goal',x:5,y:55,w:12,h:50,vertical:true},{type:'goal',x:223,y:55,w:12,h:50,vertical:true},
        {type:'zone_line',x1:100,y1:8,x2:100,y2:152},{type:'zone_line',x1:140,y1:8,x2:140,y2:152},
        {type:'player',x:50,y:55,team:'a',label:''},{type:'player',x:50,y:105,team:'a',label:''},
        {type:'player',x:120,y:80,team:'neutral',label:'J'},
        {type:'player',x:185,y:55,team:'b',label:''},{type:'player',x:185,y:105,team:'b',label:''},
        {type:'ball',x:58,y:100}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🧤 KEEPER
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'keeper', label: 'Keepertrening', defaultMin: 12, category: 'keeper',
      ages: ['8-9','10-12','13-16'], players: '1-4',
      equipment: 'Mål, baller, keeperhansker',
      nffCategory: 'sjef_over_ballen', themes: ['keeper'], nffPhases: ['forsvar_hindre_maal'],
      learningGoals: ['Grunnstilling: føtter i skulderbredde, lett på tå', 'Grep: tomler danner W, fingre spredt', 'Fall til siden, ikke bakover'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 1, max: 4 }, equipmentTags: ['maal', 'ball', 'keeperhansker'],
      description: 'Grunnleggende keeperøvelser parallelt med resten av laget. Fokus på grunnstilling, grep, enkel skuddstopp og utkast. Alle bør prøve keeperrollen.',
      setup: 'Keeper i mål. Trener eller medspiller skyter fra 8-12 meter. Start med rolige skudd, øk gradvis.',
      steps: [
        'Grunnstilling: føttene i skulderbredde, lett på tå, hendene foran.',
        'Trener ruller ball langs bakken — keeper går ned og griper.',
        'Trener kaster ball i brysthøyde — keeper fanger med "W-grep".',
        'Avslutning: spillere skyter lette skudd, keeper stopper og kaster ut.'
      ],
      coaching: [
        'Kropp bak ballen — sikre med hele kroppen',
        'Grep: tomler danner W, fingre spredt',
        'Fall til siden, ikke bakover',
        'Utkast: underarmskast for presisjon, overkast for lengde'
      ],
      variations: [
        'Keeperlek: keeper vs keeper med kast over en snor',
        '1v1 mot keeper: spillere angriper, keeper leser situasjonen'
      ],
      diagram: { width:220, height:140, field:'none', elements:[
        {type:'goal',x:60,y:3,w:100,h:18},{type:'keeper',x:110,y:20},
        {type:'player',x:70,y:110,team:'a',label:''},{type:'player',x:150,y:110,team:'a',label:''},
        {type:'ball',x:78,y:105},{type:'arrow',from:[78,105],to:[110,25],style:'shot'}
      ]}
    },

    // ═══════════════════════════════
    // 🆕 TIER 1: NYE ØVELSER (egenprodusert innhold)
    // ═══════════════════════════════

    // --- Ballsisten (leik med ball, 6-7 fokus) ---
    {
      key: 'ball_tag', label: 'Ballsisten', defaultMin: 8, category: 'oppvarming',
      ages: ['6-7', '8-9'], players: '6-20',
      equipment: '1 ball per spiller, kjegler til bane',
      nffCategory: 'sjef_over_ballen', themes: ['foering_dribling'], nffPhases: ['noytral'],
      learningGoals: ['Hold ballen nær foten mens du ser deg rundt', 'Retningsforandring for å unngå fanger', 'Bruk kroppen til å skjerme ballen'],
      intensity: 'high', hasOpposition: false,
      playerCount: { min: 6, max: 20 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Sistenlek der alle har egen ball. Fangeren fører sin ball samtidig som den prøver å ta de andre. Kombinerer ballkontroll med bevegelse og romforståelse.',
      setup: 'Avgrens et område (15x15 til 20x20m). Alle spillere har egen ball. Velg 1-2 fangere (vester).',
      steps: [
        'Alle fører ball innenfor området.',
        'Fangerne (med vest) prøver å ta de andre ved å berøre dem.',
        'Blir du tatt, stopp og gjør 5 fotbytter på ballen. Så er du fri igjen.',
        'Bytt fangere hvert 2. minutt.'
      ],
      coaching: [
        'Hold ballen nær foten — korte, raske touch',
        'Løft blikket! Se hvor fangeren er',
        'Bruk retningsforandring for å stikke unna',
        'Fangere: ikke bare jag — avskjær!'
      ],
      variations: [
        'Tatt = bli fanger selv (siste spiller igjen vinner)',
        'Fangere uten ball — sparker andres ball ut av området'
      ],
      diagram: { width:200, height:200, field:'small', elements:[
        {type:'cone',x:10,y:10},{type:'cone',x:190,y:10},{type:'cone',x:10,y:190},{type:'cone',x:190,y:190},
        {type:'player',x:60,y:80,team:'a',label:''},{type:'ball',x:68,y:76},
        {type:'player',x:140,y:60,team:'a',label:''},{type:'ball',x:148,y:56},
        {type:'player',x:90,y:150,team:'a',label:''},{type:'ball',x:98,y:146},
        {type:'player',x:50,y:40,team:'b',label:'F'},{type:'ball',x:58,y:36},
        {type:'arrow',from:[55,45],to:[80,70],style:'run'}
      ]}
    },

    // --- Press på ballfører (forsvarsspill) ---
    {
      key: 'defend_press', label: 'Press på ballfører', defaultMin: 12, category: 'spill_m_motstand',
      ages: ['8-9', '10-12', '13-16'], players: '6-16',
      equipment: 'Kjegler, vester, baller, småmål eller store mål',
      nffCategory: 'spille_med_og_mot', themes: ['forsvarsspill', '1v1_duell'], nffPhases: ['forsvar_vinne_ball'],
      learningGoals: ['Komme tett i press med riktig fart og kroppsstilling', 'Tving ballfører til én side', 'Stå mellom ballfører og mål'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 16 }, equipmentTags: ['kjegler', 'vester', 'ball', 'smaamaal'],
      description: 'Dedikert forsvarsøvelse der forsvareren øver på å presse ballfører kontrollert. Fokus på posisjonering, fart inn i press, og å tvinge ballfører dit forsvareren vil.',
      setup: 'Bane 12x18m med mål i én ende. Angripere starter ved midten, forsvarere fra siden.',
      steps: [
        'Angriper mottar ball fra trener og fører mot mål.',
        'Forsvarer starter fra siden og løper i posisjon mellom angriper og mål.',
        'Forsvarer presser kontrollert: tving til side, ikke stup inn.',
        'Angriper prøver å score. Forsvarer prøver å vinne ball eller tvinge skudd utenfra.',
        'Bytt roller etter 3 forsøk.'
      ],
      coaching: [
        'Forsvarer: stå på tå, sidelengs, lav tyngdepunkt',
        'Ikke stup inn! Vent på angriperens feil',
        'Tving angriperen mot sidelinja, vekk fra mål',
        'Angriper: bruk finter og fart for å komme forbi'
      ],
      variations: [
        '2v1: legg til en medangriper for å øve samarbeid i forsvar',
        'Gi forsvareren poeng for å tvinge skudd utenfor 16-meter'
      ],
      diagram: { width:220, height:160, field:'small', elements:[
        {type:'goal',x:70,y:5,w:80,h:16},{type:'keeper',x:110,y:18},
        {type:'player',x:110,y:120,team:'a',label:'A'},{type:'ball',x:118,y:116},
        {type:'player',x:40,y:80,team:'b',label:'F'},
        {type:'arrow',from:[110,120],to:[110,40],style:'run'},
        {type:'arrow',from:[45,80],to:[95,65],style:'run'}
      ]}
    },

    // --- Smålagsspill med betingelser ---
    {
      key: 'ssg_theme', label: 'Spill med betingelser', defaultMin: 18, category: 'smalagsspill',
      ages: ['8-9', '10-12', '13-16'], players: '8-16',
      equipment: 'Vester, baller, mål (store eller småmål), kjegler',
      nffCategory: 'smalagsspill', themes: ['spillforstaelse', 'pasning_samspill'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Tilpass spillet til betingelsen', 'Samarbeid for å oppfylle kravet', 'Les spillet og finn løsninger'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Vanlig smålagsspill med én betingelse som forsterker øktens tema. Betingelsen styrer hva spillerne må gjøre for å score, og gir treneren kontroll over læringsfokuset.',
      setup: 'Tilpass bane til antall (4v4: 25x35m, 5v5: 30x45m). To mål. Del i to lag med vester.',
      steps: [
        'Velg én betingelse og forklar den tydelig før start. Eksempler: alle på angripende lag over midtlinjen, mål teller dobbelt etter kombinasjon, eller maks 3 berøringer på siste spiller.',
        'Spill vanlig kamp med betingelsen aktiv. La spillet flyte — stopp maks 1-2 ganger kort for å forsterke temaet.',
        'Bytt betingelse halvveis for variasjon, eller fjern den og se om atferden sitter.',
        'Avslutt med fri tid uten betingelse: spill bare for gleden av det.'
      ],
      coaching: [
        'Forklar betingelsen tydelig FØR start',
        'La spillet gå — stopp kun kort for å forsterke tema',
        'Ros lagspill og løsninger, ikke bare mål',
        'Tilpass betingelsen hvis den er for lett eller vanskelig'
      ],
      variations: [
        'Jokere: 1-2 spillere alltid med angripende lag (overtall)',
        'Tidsbetingelse: scoringen teller bare i første 3 min av hver periode'
      ],
      diagram: { width:240, height:160, field:'half', elements:[
        {type:'goal',x:5,y:55,w:12,h:50,vertical:true},{type:'goal',x:223,y:55,w:12,h:50,vertical:true},
        {type:'player',x:55,y:40,team:'a',label:''},{type:'player',x:55,y:120,team:'a',label:''},
        {type:'player',x:95,y:80,team:'a',label:''},{type:'player',x:80,y:55,team:'a',label:''},
        {type:'player',x:145,y:40,team:'b',label:''},{type:'player',x:145,y:120,team:'b',label:''},
        {type:'player',x:185,y:80,team:'b',label:''},{type:'player',x:160,y:55,team:'b',label:''},
        {type:'ball',x:100,y:74}
      ]}
    },

    // --- Omstillingsspill ---
    {
      key: 'transition', label: 'Omstillingsspill', defaultMin: 15, category: 'smalagsspill',
      ages: ['10-12', '13-16'], players: '8-16',
      equipment: 'Vester (3 farger), baller, 2 mål, kjegler',
      nffCategory: 'smalagsspill', themes: ['omstilling'], nffPhases: ['angrep_fremover', 'angrep_avslutning', 'forsvar_vinne_ball'],
      learningGoals: ['Ved balltap: raskt tilbake, flest mulig på rett side av ball', 'Ved ballvinning: se fremover umiddelbart', 'Første forsvarer presser, resten organiserer'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Tre lag roterer: ett angriper, ett forsvarer, ett venter. Ved scoring eller ballvinning bytter lagene roller. Trener konstant omstilling mellom angrep og forsvar.',
      setup: 'Bane 25x35m med mål i begge ender. Tre lag à 3-5 spillere. Lag A angriper mot Lag B. Lag C venter bak ene målet.',
      steps: [
        'Lag A angriper mot Lag B sitt mål.',
        'Scorer Lag A: Lag B ut, Lag C inn som nytt forsvarslag. Lag A snur og angriper andre veien.',
        'Vinner Lag B ballen: Lag B angriper umiddelbart mot Lag C sitt mål. Lag A ut, Lag C forsvarer.',
        'Laget som er ute venter maks 30 sek, deretter byttes det uansett.',
        'Poengsystem: 1 poeng per mål, 1 ekstrapoeng for scoring innen 8 sekunder etter ballvinning.'
      ],
      coaching: [
        'OMSTILLING er nøkkelen: hodet opp i det ballen bytter lag!',
        'Forsvarende lag: raskt tilbake mellom ball og mål',
        'Angripende lag: se fremover FØR du tar kontroll',
        'Ros rask omstilling, ikke bare mål'
      ],
      variations: [
        'Uten 3. lag: etter scoring starter motstanderlaget med ball fra keeper',
        'Krav om maks 10 sek fra ballvinning til avslutning'
      ],
      diagram: { width:240, height:180, field:'half', elements:[
        {type:'goal',x:5,y:65,w:12,h:50,vertical:true},{type:'goal',x:223,y:65,w:12,h:50,vertical:true},
        {type:'player',x:60,y:50,team:'a',label:''},{type:'player',x:60,y:130,team:'a',label:''},
        {type:'player',x:100,y:90,team:'a',label:''},{type:'ball',x:108,y:86},
        {type:'player',x:160,y:50,team:'b',label:''},{type:'player',x:160,y:130,team:'b',label:''},
        {type:'player',x:190,y:90,team:'b',label:''},
        {type:'player',x:232,y:65,team:'neutral',label:'C'},{type:'player',x:232,y:90,team:'neutral',label:'C'},
        {type:'player',x:232,y:115,team:'neutral',label:'C'},
        {type:'arrow',from:[108,86],to:[200,70],style:'pass'}
      ]}
    },

    // --- Veggspill / gi-og-gå ---
    {
      key: 'wall_pass', label: 'Veggspill', defaultMin: 12, category: 'spill_m_motstand',
      ages: ['8-9', '10-12', '13-16'], players: '6-14',
      equipment: 'Kjegler, baller, småmål eller store mål',
      nffCategory: 'spille_med_og_mot', themes: ['samarbeidsspill', 'pasning_samspill'], nffPhases: ['angrep_fremover', 'angrep_avslutning'],
      learningGoals: ['Spill pasning og løp forbi forsvarer i samme bevegelse', 'Medspiller: rask returpasning i rom bak forsvarer', 'Timing mellom pasning og løp er avgjørende'],
      suggestedGroupSize: 3, intensity: 'medium', hasOpposition: true,
      playerCount: { min: 6, max: 14 }, equipmentTags: ['kjegler', 'ball', 'smaamaal'],
      description: 'Øver på gi-og-gå: spill pasning til medspiller, løp forbi forsvareren, motta returen i rom. Den mest effektive kombinasjonen for å bryte gjennom forsvar.',
      setup: 'Bane 15x20m med mål i ene enden. Tre køer: angripere sentralt, veggspillere på siden, forsvarere ved mål.',
      steps: [
        'Angriper fører ball mot forsvarer.',
        'Angriper spiller veggpasning til medspiller på siden.',
        'Angriper løper forbi forsvarer (gi-og-gå).',
        'Medspiller spiller ballen tilbake i rommet bak forsvareren.',
        'Angriper avslutter på mål. Bytt roller.'
      ],
      coaching: [
        'Pasning FØRST, løp umiddelbart etterpå',
        'Medspiller: spill ballen i rommet, ikke i beina',
        'Trekk forsvareren mot deg FØR du spiller vegg',
        'Fart etter pasningen — ikke stopp og se!'
      ],
      variations: [
        'Dobbelt veggspill: to pasninger før avslutning',
        'Legg til aktiv forsvarer som prøver å stoppe kombinasjonen'
      ],
      diagram: { width:220, height:150, field:'small', elements:[
        {type:'goal',x:70,y:5,w:80,h:16},{type:'keeper',x:110,y:18},
        {type:'player',x:110,y:120,team:'a',label:'A'},{type:'ball',x:118,y:116},
        {type:'player',x:40,y:70,team:'a',label:'V'},
        {type:'player',x:110,y:65,team:'b',label:'F'},
        {type:'arrow',from:[115,115],to:[50,75],style:'pass'},
        {type:'arrow',from:[115,115],to:[115,50],style:'run'},
        {type:'arrow',from:[50,65],to:[110,40],style:'pass'}
      ]}
    },

    // --- Avslutning med medspiller ---
    {
      key: 'finish_assist', label: 'Avslutning med medspiller', defaultMin: 12, category: 'avslutning',
      ages: ['8-9', '10-12', '13-16'], players: '6-14',
      equipment: 'Mål med keeper, baller, kjegler',
      nffCategory: 'scoringstrening', themes: ['avslutning', 'samarbeidsspill'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Tverrpasning eller tilbakelegg til medspiller i skuddposisjon', 'Avslutt på direkten eller med færrest mulig touch', 'Beveg deg inn i scoringsposisjon med riktig timing'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: false,
      playerCount: { min: 6, max: 14 }, equipmentTags: ['maal', 'ball', 'kjegler'],
      description: 'Avslutningsøvelse der to spillere samarbeider om å score. Øver på tverrballer, tilbakelegg og direkte avslutning — mer realistisk enn å skyte alene.',
      setup: 'Spillere i par. Kø sentralt og på høyre/venstre side, 20m fra mål. Keeper i mål.',
      steps: [
        'Spiller A fører ball langs siden mot dødlinja.',
        'Spiller B løper inn i boksen fra sentralt.',
        'A slår tverrball eller tilbakelegg til B.',
        'B avslutter på mål — helst på direkten.',
        'Bytt sider og roller. Varier mellom høyre og venstre.'
      ],
      coaching: [
        'Innlegger: løft blikket, finn medspillerens løp',
        'Avslutter: timing! Ikke stå stille — løp inn i ballen',
        'Avslutt raskt, keeper skal ikke rekke å flytte seg',
        'Plassering i det ledige hjørnet, ikke rett på keeper'
      ],
      variations: [
        'Legg til en forsvarer som prøver å blokkere tverrballen',
        'Varier: tilbakelegg fra dødlinja, tverrball fra 16m, gjennombrudd sentralt'
      ],
      diagram: { width:220, height:160, field:'small', elements:[
        {type:'goal',x:60,y:5,w:100,h:18},{type:'keeper',x:110,y:20},
        {type:'player',x:190,y:110,team:'a',label:'A'},{type:'ball',x:198,y:106},
        {type:'player',x:110,y:100,team:'a',label:'B'},
        {type:'arrow',from:[190,105],to:[185,40],style:'run'},
        {type:'arrow',from:[185,40],to:[120,50],style:'pass'},
        {type:'arrow',from:[115,95],to:[120,55],style:'run'},
        {type:'arrow',from:[120,55],to:[100,20],style:'shot'}
      ]}
    },

    // ═══════════════════════════════
    // 🆕 TIER 2: UTVIDET DEKNING (egenprodusert innhold)
    // ═══════════════════════════════

    // --- 2 mot 2 (+keeper) ---
    {
      key: '2v2', label: '2 mot 2', defaultMin: 12, category: 'spill_m_motstand',
      ages: ['8-9', '10-12', '13-16'], players: '8-16',
      equipment: 'Småmål eller store mål med keeper, vester, baller, kjegler',
      nffCategory: 'spille_med_og_mot', themes: ['samarbeidsspill', 'forsvarsspill', '1v1_duell'], nffPhases: ['angrep_avslutning', 'forsvar_vinne_ball'],
      learningGoals: ['Samarbeid i angrep: når drible, når spille?', 'Forsvar: fordel ansvar — én presser, én sikrer', 'Kommuniser med makker om hvem som gjør hva'],
      suggestedGroupSize: 4, intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['smaamaal', 'maal', 'vester', 'ball', 'kjegler'],
      description: 'To mot to på liten bane med mål. Mellomtingen mellom 1v1 og lagspill — her må du samarbeide med én makker for å løse situasjonen. Trener både angrep og forsvar i par.',
      setup: 'Bane 15x20m med mål (småmål eller stort med keeper) i hver ende. Par stiller opp bak hvert mål.',
      steps: [
        'Trener spiller ball inn til det ene paret.',
        'Paret angriper mot det andre parets mål.',
        'Forsvarende par prøver å vinne ball og kontre.',
        'Spill til mål, ball ut, eller 30 sek. Nye par inn.',
        'Hold poeng per par over flere runder.'
      ],
      coaching: [
        'Angrep: én fører ball, den andre tilbyr seg i rom',
        'Forsvar: én presser ballfører, den andre sikrer bak',
        'Snakk sammen! «Jeg tar ball, du sikrer»',
        'Bruk bredden — ikke stå oppå hverandre'
      ],
      variations: [
        'Med keeper: 2v2+K, større mål',
        '2v2 med jokere på sidene (3v2 i angrep)'
      ],
      diagram: { width:200, height:160, field:'small', elements:[
        {type:'goal',x:70,y:5,w:60,h:12},{type:'goal',x:70,y:143,w:60,h:12},
        {type:'player',x:75,y:70,team:'a',label:''},{type:'player',x:130,y:55,team:'a',label:''},
        {type:'ball',x:83,y:66},
        {type:'player',x:90,y:95,team:'b',label:''},{type:'player',x:140,y:85,team:'b',label:''},
        {type:'arrow',from:[80,65],to:[125,50],style:'pass'}
      ]}
    },

    // --- 1v1 med porter ---
    {
      key: '1v1_gates', label: '1 mot 1 med porter', defaultMin: 10, category: 'spill_m_motstand',
      ages: ['8-9', '10-12', '13-16'], players: '6-16',
      equipment: 'Kjegler (mange), baller',
      nffCategory: 'spille_med_og_mot', themes: ['1v1_duell', 'foering_dribling'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Angriper: les forsvareren og velg hvilken port du angriper', 'Bruk finter og retningsforandring for å åpne porter', 'Forsvarer: steng den nærmeste porten, tving til side'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 16 }, equipmentTags: ['kjegler', 'ball'],
      description: 'Duelltrening der angriperen scorer ved å føre ball gjennom én av flere kjegleporter. Forsvareren må lese angriperen og stenge porter. Trener retningsforandring og valgtaking.',
      setup: 'Firkant 12x12m. 3-4 kjegleporter (1m brede) spredt langs én side. Angriper starter med ball fra motsatt side.',
      steps: [
        'Angriper fører ball mot portene.',
        'Forsvarer starter ved portene og prøver å stenge veien.',
        'Angriper scorer ved å føre ball gjennom en åpen port.',
        'Forsvarer scorer ved å vinne ball eller tvinge angriper ut av banen.',
        'Bytt roller etter 3 forsøk. Tell poeng.'
      ],
      coaching: [
        'Angriper: løft blikket! Se hvilken port som er åpen',
        'Bruk finter for å trekke forsvareren til én side',
        'Forsvarer: stå sentralt, reager på angriperens valg',
        'Tempo! Ikke nøl — ta en avgjørelse og gjennomfør'
      ],
      variations: [
        'Flere porter = lettere for angriper',
        'To forsvarere = vanskeligere, krever mer finter'
      ],
      diagram: { width:200, height:160, field:'none', elements:[
        {type:'cone',x:40,y:15},{type:'cone',x:55,y:15},
        {type:'cone',x:90,y:15},{type:'cone',x:105,y:15},
        {type:'cone',x:140,y:15},{type:'cone',x:155,y:15},
        {type:'player',x:100,y:130,team:'a',label:'A'},{type:'ball',x:108,y:126},
        {type:'player',x:100,y:50,team:'b',label:'F'},
        {type:'arrow',from:[100,125],to:[100,60],style:'run'}
      ]}
    },

    // --- Retningsspill ---
    {
      key: 'possession_dir', label: 'Retningsspill', defaultMin: 15, category: 'smalagsspill',
      ages: ['10-12', '13-16'], players: '8-16',
      equipment: 'Vester, baller, kjegler til bane og endesoner',
      nffCategory: 'smalagsspill', themes: ['spillforstaelse', 'spilloppbygging'], nffPhases: ['angrep_fremover', 'forsvar_vinne_ball'],
      learningGoals: ['Bygg opp spillet kontrollert mot endesonen', 'Gjør deg spillbar foran ballfører med riktig vinkel', 'Ved balltap: omstill raskt og press'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['vester', 'ball', 'kjegler'],
      description: 'Ballbesittelse med retning: score ved å spille ballen kontrollert inn i motstanderens endesone. Trener spilloppbygging, romforståelse og tålmodighet i oppspillsfasen.',
      setup: 'Bane 30x20m med 3m dype endesoner i begge ender. To lag med vester. Ingen mål — score ved å motta ball i kontroll inne i endesonen.',
      steps: [
        'Laget med ball bygger opp spillet og prøver å spille en medspiller inn i motstanderens endesone.',
        'Scoring: en spiller mottar ball med kontroll inne i endesonen (foten på ballen).',
        'Ved ballvinning: det andre laget angriper andre veien.',
        'Spill 3-4 min perioder, hvile, bytt.'
      ],
      coaching: [
        'Tålmodighet! Ikke slå lange baller i panikk',
        'Gjør deg spillbar: ut av pasningsskygge, åpen kropp',
        'Spill bakover eller sideveis for å finne åpning fremover',
        'Ved balltap: press umiddelbart, ikke vent!'
      ],
      variations: [
        'Touchbegrensning (maks 3 touch) for raskere spill',
        'Joker: én nøytral spiller alltid med angripende lag'
      ],
      diagram: { width:240, height:150, field:'small', elements:[
        {type:'cone',x:10,y:10},{type:'cone',x:10,y:140},{type:'cone',x:230,y:10},{type:'cone',x:230,y:140},
        {type:'cone',x:35,y:10},{type:'cone',x:35,y:140},{type:'cone',x:205,y:10},{type:'cone',x:205,y:140},
        {type:'player',x:70,y:50,team:'a',label:''},{type:'player',x:70,y:110,team:'a',label:''},
        {type:'player',x:120,y:75,team:'a',label:''},{type:'ball',x:128,y:71},
        {type:'player',x:150,y:45,team:'b',label:''},{type:'player',x:150,y:115,team:'b',label:''},
        {type:'player',x:180,y:75,team:'b',label:''},
        {type:'arrow',from:[128,71],to:[60,45],style:'pass'}
      ]}
    },

    // --- Blokker og redd ---
    {
      key: 'block_shot', label: 'Blokker og redd', defaultMin: 10, category: 'spill_m_motstand',
      ages: ['10-12', '13-16'], players: '6-14',
      equipment: 'Mål med keeper, baller, kjegler',
      nffCategory: 'spille_med_og_mot', themes: ['forsvarsspill', 'keeper'], nffPhases: ['forsvar_hindre_maal'],
      learningGoals: ['Kom mellom ball og mål i riktig vinkel', 'Blokkér med fremsiden av kroppen, stå på beina', 'Keeper: kommuniser posisjon og gi beskjed til forsvarer'],
      suggestedGroupSize: 2, intensity: 'high', hasOpposition: true,
      playerCount: { min: 6, max: 14 }, equipmentTags: ['maal', 'ball', 'kjegler'],
      description: 'Forsvareren øver på å blokkere skudd og hindre avslutning nær eget mål. Keeper og forsvarer samarbeider om å stenge rom og vinkel. Trener NFF fase F3.',
      setup: 'Halvbane eller 20x15m foran mål med keeper. Angripere i kø 18-20m ut. Forsvarere starter ved 16-meteren.',
      steps: [
        'Angriper mottar ball fra trener og fører mot mål.',
        'Forsvarer rykker ut og posisjonerer seg mellom angriper og mål.',
        'Angriper forsøker å score. Forsvarer blokkerer eller vinner ball.',
        'Keeper kommuniserer: «Hold side!», «Jeg har nær stolpe!»',
        'Bytt roller etter 3 forsøk.'
      ],
      coaching: [
        'Forsvarer: stå på beina, ikke kast deg ned for tidlig',
        'Blokkér med fremsiden av kroppen — aldri ryggen til',
        'Steng ett hjørne, la keeper ta det andre',
        'Keeper: snakk! Fortell forsvareren hvor du er'
      ],
      variations: [
        '2v1 nær mål: to angripere mot én forsvarer + keeper',
        'Innlegg fra siden: forsvarer må markere og cleare'
      ],
      diagram: { width:220, height:150, field:'small', elements:[
        {type:'goal',x:60,y:5,w:100,h:18},{type:'keeper',x:110,y:20},
        {type:'player',x:110,y:120,team:'a',label:'A'},{type:'ball',x:118,y:116},
        {type:'player',x:110,y:60,team:'b',label:'F'},
        {type:'arrow',from:[110,115],to:[110,70],style:'run'},
        {type:'arrow',from:[110,35],to:[110,55],style:'run'}
      ]}
    },

    // --- Keeperduell ---
    {
      key: 'keeper_play', label: 'Keeperduell', defaultMin: 10, category: 'keeper',
      ages: ['8-9', '10-12'], players: '4-10',
      equipment: '2 småmål (eller store mål), baller',
      nffCategory: 'sjef_over_ballen', themes: ['keeper'], nffPhases: ['forsvar_hindre_maal'],
      learningGoals: ['Grunnstilling og forflytning i målet', 'Grep og skyv ved lave og høye skudd', 'Rask reaksjon og igangsetting etter redning'],
      suggestedGroupSize: 2, intensity: 'medium', hasOpposition: false,
      playerCount: { min: 4, max: 10 }, equipmentTags: ['smaamaal', 'maal', 'ball'],
      description: 'To keepere mot hverandre i hver sitt mål på kort avstand. Trener reaksjon, grep, plassering og utspark. Morsomt og intenst — alle får mange repetisjoner.',
      setup: 'To mål (småmål eller store) 8-12m fra hverandre. Én keeper i hvert mål. Ekstra baller bak målene.',
      steps: [
        'Keeper A kaster eller sparker ballen mot Keeper Bs mål.',
        'Keeper B forsøker å redde og angriper umiddelbart tilbake.',
        'Spill fram og tilbake i perioder på 2 minutter.',
        'Tell poeng: mål = 1 poeng, redning + kontroll = 1 poeng til forsvarer.',
        'Roter keepere slik at alle prøver seg.'
      ],
      coaching: [
        'Grunnstilling: lav, vekt fremover, på tå',
        'Grep: hendene bak ballen, fingre spredt (W-grep)',
        'Etter redning: kontroll først, så kast/spark raskt',
        'Plassering: stå sentralt, følg ballens posisjon'
      ],
      variations: [
        'Spillere på sidene skyter i stedet for keeperne',
        'Større avstand (15m) for å øve utspark'
      ],
      diagram: { width:200, height:120, field:'none', elements:[
        {type:'goal',x:10,y:30,w:12,h:60,vertical:true},{type:'goal',x:178,y:30,w:12,h:60,vertical:true},
        {type:'keeper',x:25,y:60},{type:'keeper',x:175,y:60},
        {type:'ball',x:50,y:55},
        {type:'arrow',from:[50,55],to:[165,65],style:'pass'}
      ]}
    },

    // --- Stafett med ball ---
    {
      key: 'relay_ball', label: 'Stafett med ball', defaultMin: 8, category: 'oppvarming',
      ages: ['6-7', '8-9'], players: '6-20',
      equipment: 'Baller, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['foering_dribling'], nffPhases: ['noytral'],
      learningGoals: ['Før ballen i fart uten å miste kontroll', 'Vend med ball rundt kjegle', 'Legg til fart gradvis — kontroll først'],
      intensity: 'high', hasOpposition: false,
      playerCount: { min: 6, max: 20 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Lagstafett der spillerne fører ball gjennom en kjegleløype og tilbake. Kombinerer ballkontroll med fart og lagkonkurranse. Perfekt oppvarming med mye engasjement.',
      setup: 'To eller flere lag i kø bak en startlinje. Kjegleløype 10-15m foran (rett linje, slalåm, eller sirkelbane).',
      steps: [
        'Første spiller på hvert lag fører ball gjennom løypa og tilbake.',
        'Overlever ballen til neste i køen med en pasning.',
        'Laget som fullfører først vinner runden.',
        'Kjør 3-4 runder med ulike løyper eller regler.'
      ],
      coaching: [
        'Kontroll først, fart etterpå — ballen må være nær foten',
        'Bruk innsiden og utsiden rundt kjeglene',
        'Hei på lagkameratene! Sørg for at alle er klare',
        'Presis overlevering: pasning til neste, ikke bare spark den'
      ],
      variations: [
        'Kun venstre fot, kun utside',
        'Løype med vending + skudd på mål til slutt'
      ],
      diagram: { width:220, height:140, field:'none', elements:[
        {type:'player',x:20,y:25,team:'a',label:''},{type:'player',x:20,y:50,team:'a',label:''},
        {type:'player',x:20,y:75,team:'a',label:''},{type:'ball',x:28,y:21},
        {type:'player',x:20,y:100,team:'b',label:''},{type:'player',x:20,y:125,team:'b',label:''},
        {type:'cone',x:75,y:50},{type:'cone',x:110,y:90},{type:'cone',x:145,y:50},{type:'cone',x:180,y:90},
        {type:'arrow',from:[30,25],to:[70,50],style:'run'},
        {type:'arrow',from:[75,55],to:[105,85],style:'run'},
        {type:'arrow',from:[110,85],to:[140,50],style:'run'}
      ]}
    },

    // ═══════════════════════════════
    // 🆕 TIER 3: 13-16 ÅR SPESIFIKKE (egenprodusert innhold)
    // ═══════════════════════════════

    // --- Prepp'n (oppvarming ungdom) ---
    {
      key: 'prepp', label: 'Prepp\u2019n', defaultMin: 12, category: 'oppvarming',
      ages: ['13-16'], players: '8-22',
      equipment: 'Baller, kjegler',
      nffCategory: 'sjef_over_ballen', themes: ['foering_dribling', 'vendinger_mottak'], nffPhases: ['noytral'],
      learningGoals: ['Fart i beina: høy frekvens i forflytninger med og uten ball', 'Fart i ballen: rask ballhåndtering med begge føtter', 'Kroppskontroll: kontroll på overkropp i utgangsstillinger og retningsforandringer'],
      intensity: 'medium', hasOpposition: false,
      playerCount: { min: 8, max: 22 }, equipmentTags: ['ball', 'kjegler'],
      description: 'Strukturert oppvarming for ungdom. Fokus på fart i hodet, fart i beina og fart i ballen. Gjør spillerne spilleklare for høy intensitet i spill. Bør knyttes til øktens tema.',
      setup: 'Firkant 15x15m med kjegler. Alle spillere med ball. Kan kjøres i par eller individuelt.',
      steps: [
        'Føring (3 min): alle fører ball i firkanten. Trener roper kommandoer — innside, utside, såle, vending, tempoøkning.',
        'Frekvens (3 min): ball i hendene, kjappe føtter over ball, sidesteg langs kjegler, akselerasjon ut.',
        'Pasning i par (4 min): kort avstand, vekslende pasning med førstetouch i bevegelse. Øk avstand gradvis.',
        'Fritt (2 min): kombiner føring, vending og pasning i fritt tempo med stigende fart.'
      ],
      coaching: [
        'Kontroll på overkroppen: stå rett, ikke len deg forover',
        'Høy frekvens i beina, korte raske steg',
        'Førstetouch legger ballen klar for neste handling',
        'Knytt aktivitetene til øktens tema — f.eks. vendinger hvis tema er spilloppbygging'
      ],
      variations: [
        'Med motstand: legg til en passiv jager i del 1',
        'Konkurranseform: hvem klarer flest vendinger på 30 sek?'
      ],
      diagram: { width:200, height:200, field:'small', elements:[
        {type:'cone',x:20,y:20},{type:'cone',x:180,y:20},{type:'cone',x:20,y:180},{type:'cone',x:180,y:180},
        {type:'player',x:60,y:70,team:'a',label:''},{type:'ball',x:68,y:66},
        {type:'player',x:140,y:90,team:'a',label:''},{type:'ball',x:148,y:86},
        {type:'player',x:80,y:140,team:'a',label:''},{type:'ball',x:88,y:136},
        {type:'player',x:120,y:50,team:'a',label:''},{type:'ball',x:128,y:46},
        {type:'arrow',from:[65,75],to:[100,100],style:'run'},
        {type:'arrow',from:[145,85],to:[115,65],style:'run'}
      ]}
    },

    // --- Spilloppbygging bakfra ---
    {
      key: 'build_up', label: 'Spilloppbygging bakfra', defaultMin: 15, category: 'smalagsspill',
      ages: ['13-16'], players: '10-18',
      equipment: 'Vester (2-3 farger), baller, store mål med keeper, kjegler',
      nffCategory: 'smalagsspill', themes: ['spilloppbygging', 'pasning_samspill'], nffPhases: ['angrep_fremover'],
      learningGoals: ['Keeper/back: ro med ball, åpne i førstetouch, true med blikk', 'Midtbane: spillbar i framrom med oversikt fremover', 'Unngå å gi bort presseøyeblikk — kontrollert oppspill ut av press'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 10, max: 18 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Laget øver på å spille seg ut bakfra mot organisert press. Keeper starter, backer og midtbane bygger opp, angrepsspillerne tilbyr seg i rom. Trener NFF fase A1.',
      setup: 'Halv bane. Keeper + 4-5 oppbyggingsspillere mot 3-4 pressende motstandere. Mål å spille ballen over midtlinjen kontrollert (eller til mottaker i endesone).',
      steps: [
        'Keeper starter med ball (utspark eller utkast til back).',
        'Backene og midtbanen tilbyr seg med riktig avstand og vinkel.',
        'Pressende lag forsøker å vinne ball og score på motangrep.',
        'Oppbyggingslaget scorer ved å spille en spiller gjennom midtsonen med ball i kontroll.',
        'Ved ballvinning for presslaget: score på stort mål innen 8 sek.'
      ],
      coaching: [
        'Keeper: oversikt først, ikke bare spark den lang',
        'Backer: åpen kropp, se begge sider FØR du får ballen',
        'Midtbane: gjør deg spillbar mellom linjene, vis deg!',
        'Presslaget: les presseøyeblikk — støttepasning, dårlig touch, ball til keeper'
      ],
      variations: [
        'Øk antall pressende spillere for mer utfordring',
        'Krav: minst 3 pasninger før ballen kan krysse midtlinjen'
      ],
      diagram: { width:240, height:180, field:'half', elements:[
        {type:'goal',x:5,y:65,w:12,h:50,vertical:true},{type:'keeper',x:20,y:90},
        {type:'player',x:55,y:45,team:'a',label:''},{type:'player',x:55,y:135,team:'a',label:''},
        {type:'player',x:100,y:70,team:'a',label:''},{type:'player',x:100,y:110,team:'a',label:''},
        {type:'ball',x:28,y:88},
        {type:'player',x:130,y:55,team:'b',label:''},{type:'player',x:130,y:125,team:'b',label:''},
        {type:'player',x:160,y:90,team:'b',label:''},
        {type:'arrow',from:[28,88],to:[50,50],style:'pass'},
        {type:'arrow',from:[55,50],to:[95,75],style:'pass'}
      ]}
    },

    // --- Soneforsvar intro ---
    {
      key: 'zone_defense', label: 'Soneforsvar', defaultMin: 15, category: 'spill_m_motstand',
      ages: ['13-16'], players: '10-18',
      equipment: 'Vester, baller, store mål med keeper, kjegler',
      nffCategory: 'spille_med_og_mot', themes: ['forsvarsspill'], nffPhases: ['forsvar_vinne_ball', 'forsvar_hindre_maal'],
      learningGoals: ['Posisjonering i forhold til ball og medspillere, ikke motspillere', 'Sideforskyvning som enhet: korte og smale når ball er sentralt', 'Lese presseøyeblikk og reagere samlet'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 10, max: 18 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Forsvarslaget øver på å bevege seg som enhet: sideforskyvning, pumping (opp/ned) og samlet press. Angrepslaget prøver å trenge gjennom. Trener NFF fase F1/F2.',
      setup: 'Halv bane med stort mål og keeper. Forsvarslag (4-5 spillere) mot angrepsslag (5-6 spillere). Angrepslaget starter med ball fra midten.',
      steps: [
        'Angrepslaget bygger opp og prøver å score.',
        'Forsvarslaget holder formasjon: sideforskyvning mot ball, pumper opp ved press.',
        'Trener fryser spillet 2-3 ganger for å vise posisjoner.',
        'Ved ballvinning: forsvarslaget spiller raskt til en mottaker over midtlinjen (omstilling).',
        'Bytt roller etter 5 min.'
      ],
      coaching: [
        'Se på ballen, ikke motspillerne — posisjoner dere ift ball',
        'Korte avstander! Glipper det mellom to, kommer ballen gjennom',
        'Når ball er på siden: forskyv samlet, steng midten',
        'Presssignaler: dårlig touch, ball til back, feilvendt spiller → PRESS SAMLET!'
      ],
      variations: [
        'Begynn uten mål: forsvarslaget scorer ved ballvinning + 5 pasninger',
        '3 linjer: backer, midtbane, angrep — øv pumping mellom leddene'
      ],
      diagram: { width:240, height:180, field:'half', elements:[
        {type:'goal',x:5,y:65,w:12,h:50,vertical:true},{type:'keeper',x:20,y:90},
        {type:'player',x:60,y:50,team:'b',label:''},{type:'player',x:60,y:90,team:'b',label:''},
        {type:'player',x:60,y:130,team:'b',label:''},{type:'player',x:90,y:70,team:'b',label:''},
        {type:'player',x:90,y:110,team:'b',label:''},
        {type:'player',x:140,y:40,team:'a',label:''},{type:'player',x:140,y:90,team:'a',label:''},
        {type:'player',x:140,y:140,team:'a',label:''},{type:'player',x:180,y:65,team:'a',label:''},
        {type:'player',x:180,y:115,team:'a',label:''},{type:'ball',x:148,y:86},
        {type:'arrow',from:[65,55],to:[65,85],style:'run'},{type:'arrow',from:[65,125],to:[65,95],style:'run'}
      ]}
    },

    // --- Situasjonsøvelse angrep ---
    {
      key: 'sit_attack', label: 'Situasjonsøvelse angrep', defaultMin: 15, category: 'spill_m_motstand',
      ages: ['13-16'], players: '10-18',
      equipment: 'Vester, baller, store mål med keeper, kjegler',
      nffCategory: 'spille_med_og_mot', themes: ['samarbeidsspill', 'avslutning'], nffPhases: ['angrep_fremover', 'angrep_avslutning'],
      learningGoals: ['Ballfører: ro med ball, true med blikk, spille kontrollert fremover', 'Medspillere: bevegelse for å skape og utnytte overtall', 'Avslutning: kort tid mellom nest siste touch og skudd'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 10, max: 18 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Kamplik øvelse med mange repetisjoner inn mot angrepstemaet. Starter med oppspill fra trener/keeper, angrepsspillerne kombinerer seg gjennom forsvar og avslutter. NFF fase A2/A3.',
      setup: 'Halv bane med mål og keeper. Angrepsgruppe (3-5 spillere) mot forsvarsgruppe (2-4 spillere). Trener/keeper igangsetter.',
      steps: [
        'Trener spiller ball til en angrepsspiller sentralt eller på siden.',
        'Angrepslaget kombinerer seg mot mål (overtall eller likt antall).',
        'Forsvarslaget prøver å vinne ball — ved vinning spill raskt over midtlinjen.',
        'Ny ball fra trener umiddelbart etter avslutning/ball ut.',
        'Mange repetisjoner! 10-12 angrep på 5 min, deretter bytt.'
      ],
      coaching: [
        'Angrip hurtig fremover — ikke overspill, ta sjansen!',
        'Beveg dere bak, forbi og foran ballfører',
        'True flere rom samtidig: bakrom, mellomrom',
        'Avslutter: se på keeper, plassering framfor kraft'
      ],
      variations: [
        'Start med 3v2, øk til 4v3 eller 5v4',
        'Krav: scoring innen 8 sekunder etter igangsetting'
      ],
      diagram: { width:240, height:180, field:'half', elements:[
        {type:'goal',x:5,y:65,w:12,h:50,vertical:true},{type:'keeper',x:20,y:90},
        {type:'player',x:80,y:60,team:'b',label:'F'},{type:'player',x:80,y:120,team:'b',label:'F'},
        {type:'player',x:150,y:50,team:'a',label:''},{type:'player',x:150,y:90,team:'a',label:''},
        {type:'player',x:150,y:130,team:'a',label:''},{type:'ball',x:158,y:86},
        {type:'arrow',from:[155,85],to:[90,65],style:'pass'},
        {type:'arrow',from:[155,50],to:[60,50],style:'run'}
      ]}
    },

    // --- Situasjonsøvelse forsvar ---
    {
      key: 'sit_defend', label: 'Situasjonsøvelse forsvar', defaultMin: 15, category: 'spill_m_motstand',
      ages: ['13-16'], players: '10-18',
      equipment: 'Vester, baller, store mål med keeper, kjegler',
      nffCategory: 'spille_med_og_mot', themes: ['forsvarsspill'], nffPhases: ['forsvar_vinne_ball', 'forsvar_hindre_maal'],
      learningGoals: ['Førsteforsvarer: tett i press, styr ballfører vekk fra mål', 'Resten: sikring bak press, steng rom sentralt', 'Ved ballvinning: hurtig omstilling til angrep'],
      intensity: 'high', hasOpposition: true,
      playerCount: { min: 10, max: 18 }, equipmentTags: ['vester', 'ball', 'maal', 'kjegler'],
      description: 'Kamplik øvelse med fokus på forsvarsspill. Forsvarslaget øver på å stoppe organiserte angrep gjennom press, sikring og blokkering. NFF fase F1/F2/F3.',
      setup: 'Halv bane med mål og keeper. Forsvargruppe (3-4 spillere) mot angrepsgruppe (4-5 spillere i overtall). Angrepslaget har fritt spill.',
      steps: [
        'Angrepslaget starter med ball og angriper fritt mot mål.',
        'Forsvarslaget organiserer seg: første forsvarer presser, andre sikrer.',
        'Keeper kommuniserer: «Steng side!», «Hold linja!»',
        'Ved ballvinning: forsvarslaget kontrerer raskt mot småmål på midtlinjen.',
        'Ny ball umiddelbart etter avslutning. 10-12 repetisjoner per periode.'
      ],
      coaching: [
        'Første forsvarer: riktig fart inn i press, korte steg, stå på beina',
        'Sikring: tett bak, steng rom mellom forsvarer og mål',
        'Kommuniser! «Jeg tar ball, du sikrer», «Hold feilvendt!»',
        'Blokkér skudd med fremsiden av kroppen'
      ],
      variations: [
        'Start i undertall (2v3) for å øve desperatforsvar',
        'Fokus F3: angrep starter med innlegg fra siden'
      ],
      diagram: { width:240, height:180, field:'half', elements:[
        {type:'goal',x:5,y:65,w:12,h:50,vertical:true},{type:'keeper',x:20,y:90},
        {type:'player',x:70,y:55,team:'b',label:'F'},{type:'player',x:70,y:90,team:'b',label:'F'},
        {type:'player',x:70,y:125,team:'b',label:'F'},
        {type:'player',x:140,y:40,team:'a',label:''},{type:'player',x:160,y:80,team:'a',label:''},
        {type:'player',x:140,y:120,team:'a',label:''},{type:'player',x:190,y:80,team:'a',label:''},
        {type:'ball',x:168,y:76},
        {type:'arrow',from:[75,60],to:[150,50],style:'run'},
        {type:'arrow',from:[73,93],to:[73,78],style:'run'},{type:'arrow',from:[73,122],to:[73,100],style:'run'}
      ]}
    },

    // --- Innlegg og avslutning ---
    {
      key: 'cross_finish', label: 'Innlegg og avslutning', defaultMin: 12, category: 'avslutning',
      ages: ['13-16'], players: '8-16',
      equipment: 'Store mål med keeper, baller, kjegler',
      nffCategory: 'scoringstrening', themes: ['avslutning', 'samarbeidsspill'], nffPhases: ['angrep_avslutning'],
      learningGoals: ['Innlegger: løft blikket, slå ballen i rom som angripes', 'Avslutter: true 1. stolpe, bakre stolpe eller 45 med timing', 'Bevegelser for å komme først på ballen: sprint, stå i ro, fra-imot'],
      intensity: 'high', hasOpposition: false,
      playerCount: { min: 8, max: 16 }, equipmentTags: ['maal', 'ball', 'kjegler'],
      description: 'Innleggsøvelse med avslutning fra ulike posisjoner i boksen. Kantspiller slår innlegg, medspillere angriper rom foran mål. Trener NFF fase A3 med fokus på siste pasning og avslutning.',
      setup: 'Halvbane med stort mål og keeper. Innleggere på begge kanter (ved sidelinja, 25m fra mål). Avsluttere i kø sentralt, 20m fra mål.',
      steps: [
        'Innlegger mottar ball fra trener og fører mot dødlinja.',
        'Avslutter starter løp inn i boksen: veksle mellom 1. stolpe, bakre stolpe og «45».',
        'Innlegger slår ball i rom som avslutteren angriper.',
        'Avslutter scorer med ett eller to touch.',
        'Veksle mellom høyre og venstre side. Roter roller.'
      ],
      coaching: [
        'Innlegger: se opp FØR du slår — finn medspillerens løp',
        'Avslutter: timing! Start løpet når innlegger ser opp',
        'True 1. stolpe tidlig, juster til bakre stolpe sent',
        'Plassering: styr ballen tilbake dit den kom fra (vanskeligst for keeper)'
      ],
      variations: [
        'Legg til forsvarer i boksen som markerer avslutteren',
        'Pasningsinnlegg lavt langs bakken (cutback) i stedet for høyt innlegg'
      ],
      diagram: { width:240, height:180, field:'none', elements:[
        {type:'goal',x:80,y:5,w:80,h:18},{type:'keeper',x:120,y:20},
        {type:'player',x:210,y:120,team:'a',label:'K'},{type:'ball',x:218,y:116},
        {type:'player',x:120,y:110,team:'a',label:'A'},
        {type:'player',x:90,y:110,team:'a',label:''},
        {type:'arrow',from:[210,115],to:[200,40],style:'run'},
        {type:'arrow',from:[200,40],to:[130,50],style:'pass'},
        {type:'arrow',from:[120,105],to:[130,45],style:'run'},
        {type:'arrow',from:[90,105],to:[100,50],style:'run'}
      ]}
    },

    // ── EGENDEFINERT (alltid nederst) ──
    { key: 'custom', label: 'Skriv inn selv', defaultMin: 10, isCustom: true, category: 'special',
      nffCategory: 'sjef_over_ballen', themes: [], nffPhases: [], learningGoals: [],
      intensity: 'medium', hasOpposition: false }
  ];

  // Migration map for removed/renamed exercise keys
  const KEY_MIGRATION = {
    'warm_no_ball': 'tag',
    'long_pass': 'pass_pair',
    'pass_turn': 'receive_turn',
    'juggle': 'custom',
    'competitions': 'custom',
    'overload': '2v1',
    'possession_joker': 'possession',
    'possession_even': 'possession',
    'square_german': 'square_game',
    'surprise': 'ssg',
  };

  function migrateExerciseKey(key) {
    return KEY_MIGRATION[key] || key;
  }

  // Migrate a stored exercise object: remap old keys, preserve customName for custom fallback
  function migrateExerciseObj(exObj) {
    if (!exObj || !exObj.exerciseKey) return exObj;
    const oldKey = exObj.exerciseKey;
    const newKey = migrateExerciseKey(oldKey);
    if (newKey !== oldKey) {
      exObj.exerciseKey = newKey;
      if (newKey === 'custom' && !exObj.customName) {
        const oldMeta = { 'juggle': 'Triksing med ball', 'competitions': 'Konkurranser' };
        exObj.customName = oldMeta[oldKey] || oldKey;
      }
    }
    // Safety net: if key doesn't exist in current EXERCISES catalog, treat as custom
    if (exObj.exerciseKey !== 'custom' && !EX_BY_KEY.has(exObj.exerciseKey)) {
      const lostName = exObj.exerciseKey;
      exObj.exerciseKey = 'custom';
      if (!exObj.customName) exObj.customName = lostName;
      console.warn('[workout.js] Ukjent \u00f8velses-key migrert til custom:', lostName);
    }
    return exObj;
  }

  const EX_BY_KEY = new Map(EXERCISES.map(x => [x.key, x]));

  // Category definitions for optgroup rendering
  const EXERCISE_CATEGORIES = [
    { id: 'oppvarming', label: '🏃 Oppvarming' },
    { id: 'teknikk', label: '⚽ Teknikk' },
    { id: 'avslutning', label: '🎯 Avslutning' },
    { id: 'spill_m_motstand', label: '⚔️ Spill med motstand' },
    { id: 'smalagsspill', label: '🏟️ Smålagsspill' },
    { id: 'keeper', label: '🧤 Keeper' },
  ];

  // -------------------------
  // NFF-struktur: Aktivitetskategorier, temaer, læringsmomenter
  // Basert på NFFs skoleringsplaner 2021 og spillmodell.
  // Begreper og struktur er offentlige retningslinjer. Alt innhold er egenprodusert.
  // -------------------------

  const NFF_CATEGORIES = [
    { id: 'sjef_over_ballen',   label: '⚽ Sjef over ballen',   short: 'Sjef',    color: '#2e8b57',
      label1316: '⚽ Prepp\u2019n', short1316: 'Prepp' },
    { id: 'spille_med_og_mot',  label: '⚔️ Spille med og mot',  short: 'Øvelse',  color: '#e67e22',
      label1316: '⚔️ Situasjonsøving', short1316: 'Situasjon' },
    { id: 'smalagsspill',       label: '🏟️ Smålagsspill',       short: 'Spill',   color: '#3498db',
      label1316: '🏟️ Spill', short1316: 'Spill' },
    { id: 'scoringstrening',    label: '🎯 Scoringstrening',    short: 'Scoring', color: '#e74c3c',
      label1316: '🎯 Avslutning', short1316: 'Avslutning' },
  ];

  const NFF_CATEGORY_BY_ID = Object.fromEntries(NFF_CATEGORIES.map(c => [c.id, c]));

  /** Get age-appropriate label for NFF category */
  function catLabel(cat, ageGroup) {
    return (ageGroup === '13-16' && cat.label1316) ? cat.label1316 : cat.label;
  }
  function catShort(cat, ageGroup) {
    return (ageGroup === '13-16' && cat.short1316) ? cat.short1316 : cat.short;
  }

  // Treningstemaer knyttet til NFFs spillmodell
  const NFF_THEMES = [
    { id: 'foering_dribling',   label: 'Føring og dribling',    phase: 'angrep',  icon: '🏃' },
    { id: 'vendinger_mottak',   label: 'Vendinger og mottak',   phase: 'angrep',  icon: '🔄' },
    { id: 'pasning_samspill',   label: 'Pasning og samspill',   phase: 'angrep',  icon: '🤝' },
    { id: 'avslutning',         label: 'Avslutning',            phase: 'angrep',  icon: '🎯' },
    { id: '1v1_duell',          label: '1 mot 1',               phase: 'begge',   icon: '⚡' },
    { id: 'samarbeidsspill',    label: 'Samarbeidsspill',        phase: 'angrep',  icon: '👥' },
    { id: 'forsvarsspill',      label: 'Forsvarsspill',          phase: 'forsvar', icon: '🛡️' },
    { id: 'omstilling',         label: 'Omstilling',             phase: 'begge',   icon: '🔁' },
    { id: 'spilloppbygging',    label: 'Spilloppbygging',        phase: 'angrep',  icon: '📐' },
    { id: 'keeper',             label: 'Keeper',                 phase: 'forsvar', icon: '🧤' },
  ];

  const NFF_THEME_BY_ID = Object.fromEntries(NFF_THEMES.map(t => [t.id, t]));

  // Hvilke temaer er relevante per aldersgruppe
  const NFF_THEMES_BY_AGE = {
    '6-7':  ['foering_dribling', 'avslutning', '1v1_duell'],
    '8-9':  ['foering_dribling', 'vendinger_mottak', 'pasning_samspill', 'avslutning', '1v1_duell', 'samarbeidsspill', 'forsvarsspill'],
    '10-12': ['foering_dribling', 'vendinger_mottak', 'pasning_samspill', 'avslutning', '1v1_duell', 'samarbeidsspill', 'forsvarsspill', 'omstilling', 'spilloppbygging', 'keeper'],
    '13-16': ['foering_dribling', 'vendinger_mottak', 'pasning_samspill', 'avslutning', '1v1_duell', 'samarbeidsspill', 'forsvarsspill', 'omstilling', 'spilloppbygging', 'keeper'],
  };

  // Anbefalt tidsfordeling per aldersgruppe (prosent av total økttid, ekskl. drikkepause)
  const NFF_TIME_DISTRIBUTION = {
    '6-7':  { sjef_over_ballen: 35, spille_med_og_mot: 5,  smalagsspill: 50, scoringstrening: 10 },
    '8-9':  { sjef_over_ballen: 20, spille_med_og_mot: 20, smalagsspill: 45, scoringstrening: 15 },
    '10-12': { sjef_over_ballen: 15, spille_med_og_mot: 25, smalagsspill: 45, scoringstrening: 15 },
    '13-16': { sjef_over_ballen: 15, spille_med_og_mot: 35, smalagsspill: 40, scoringstrening: 10 },
  };

  // Læringsmomenter per tema per aldersgruppe (egne formuleringer)
  const NFF_LEARNING_GOALS = {
    'foering_dribling': {
      '6-7':  ['Hold ballen nær foten med korte touch', 'Bruk ulike deler av foten (innside, utside, såle)', 'Løft blikket mens du fører ballen'],
      '8-9':  ['Fart i føringen: tett ball i press, lengre touch i åpent rom', 'Bruk kroppen til å skjerme ballen', 'Se fremover og ta valg: føre, drible eller spille'],
      '10-12': ['Føring i fart med retningsforandring under press', 'Velg riktig teknikk for situasjonen', 'Retningsbestemt føring mot ledig rom'],
      '13-16': ['Korte hurtige touch med begge føtter for å utnytte rom', 'Beholde oversikt med ball i beina, kunne ombestemme valg', 'Fartsvariasjon og retningsforandring for å skape overtall'],
    },
    'vendinger_mottak': {
      '8-9':  ['Sjekk over skulderen FØR ballen kommer', 'Åpne kroppen mot dit du vil vende', 'Førstetouch i retning du skal spille'],
      '10-12': ['Mottak under press med skjermingskontakt', 'Varier vendeteknikk etter situasjonen', 'Retningsbestemt mottak med begge føtter'],
      '13-16': ['Ro med ball, åpne i førstetouch, true med blikk og fot', 'Mottak med fart: første touch setter opp neste handling', 'Vende i press for å utnytte rom bak motstander'],
    },
    'pasning_samspill': {
      '6-7':  ['Spark ballen med innsiden av foten', 'Pek støttefoten mot den du sender til'],
      '8-9':  ['Orientert førsteberøring: se mot mål før mottak', 'Beveg deg etter pasning (slå og gå)', 'Gjør deg spillbar: finn rom, ut av pasningsskygge'],
      '10-12': ['Spill med færrest mulig berøringer under press', 'Veggspill og kombinasjoner', 'Les medspillerens bevegelse, spill i rom'],
      '13-16': ['Spille kontrollert fremover, søke igjennom framfor rundt', 'Skape nye rom med pasninger i riktig fart til riktig fot', 'Prinsipper: opp-tilbake-igjennom, fra trangt til ledig'],
    },
    'avslutning': {
      '6-7':  ['Plassering foran kraft: sikte mot mål', 'Tørr å skyte!'],
      '8-9':  ['Plassering i hjørnene, lav avslutning', 'Avslutt raskt, ikke nøl', 'Følg opp skuddet, vær klar for retur'],
      '10-12': ['Avslutning under press (tidskrav, forsvarer)', 'Les keeper: velg hjørne', 'Avslutning fra ulike vinkler og avstander'],
      '13-16': ['Kort tid mellom nest siste touch og avslutning', 'True 1. stolpe, bakre stolpe og 45 med bevegelse', 'Se på keeper, så på ball — plassering framfor kraft'],
    },
    '1v1_duell': {
      '6-7':  ['Tørr å utfordre motspilleren', 'Bruk kroppen for å beskytte ballen'],
      '8-9':  ['Angriper: brems opp, bruk finter', 'Forsvarer: stå sidelengs, vær tålmodig', 'Lav tyngdepunkt for rask retningsendring'],
      '10-12': ['Les forsvarerens kropp: angrip den svake siden', 'Fartsvariasjon: brems-akseler', 'Forsvarer: tving til svak fot, steng rom mot mål'],
      '13-16': ['Utnytte dårlige, lange og for mange touch hos motstander', 'Aktiv armbruk ved duellspill og kroppskontakt', 'Ta rommet mellom ballfører og ball før du tar ball'],
    },
    'samarbeidsspill': {
      '8-9':  ['Angriper med ball: trekk forsvarer FØR pasning', 'Angriper uten ball: hold avstand og vinkel', 'Timing: spill pasning i riktig øyeblikk'],
      '10-12': ['Trekantspill: spill og beveg deg til ny posisjon', 'Veggspill: gi-og-gå forbi forsvarer', 'Les medspiller, tilpass fart og vinkel'],
      '13-16': ['Bevegelse for å skape og utnytte overtall sammen med ballfører', 'Flere bevegelser etter hverandre for å åpne rom', 'Spillbarhet med riktig avstand og vinkel i alle situasjoner'],
    },
    'forsvarsspill': {
      '8-9':  ['Tett opp i ballfører, press!', 'Stå mellom ballfører og eget mål', 'Alle tilbake raskt ved balltap'],
      '10-12': ['Steng pasningslinjer, tving til side', 'Beveg dere som enhet (soneprinsipp)', 'Omstilling: første forsvarer presser, andre sikrer'],
      '13-16': ['Komme tett i press med riktig fart, korte ned stegene', 'Lese presseøyeblikk: støttepasning, dårlig touch, feilvendt spiller', 'Soneforsvar: posisjonering ift ball og medspillere, sideforskyvning og pumping'],
    },
    'omstilling': {
      '10-12': ['Raskt tilbake ved balltap', 'Første forsvarer presser, resten organiserer', 'Ved ballvinning: se fremover umiddelbart'],
      '13-16': ['Ved balltap: fortest mulig flest mulig på rett side av ball', 'Ved ballvinning: identifiser balanseforhold — kontring eller kontroll?', 'Hurtig samlet reaksjon på definerte press-signaler'],
    },
    'spilloppbygging': {
      '10-12': ['Keeper/back starter rolig, bygg opp bakfra', 'Finn den frie spilleren mellom linjene', 'Tålmodighet: ikke slå lange baller i panikk'],
      '13-16': ['Ro med ball, åpne i førstetouch, true med blikk og fot', 'Unngå å gi bort presseøyeblikk — kontrollert oppspill', 'Fra små rom til store rom, opp og ned, inn og ut'],
    },
    'keeper': {
      '8-9':  ['Grunnstilling: føtter i skulderbredde, lett på tå', 'W-grep, fingre spredt', 'Fall til siden, ikke bakover'],
      '10-12': ['Les angriperens kropp: forutse skuddretning', 'Utkast/utspark for rask omstilling', 'Kommuniser med forsvarslinja'],
      '13-16': ['Posisjonering i forhold til forsvar og motstander', 'Pasningsalternativ for vending av spill', 'Kommunikasjon: styre leddet foran, tetthet og pumping'],
    },
  };

  /**
   * Hent læringsmomenter for et gitt tema og aldersgruppe.
   * Fallback til nærmeste eldre aldersgruppe hvis ingen spesifikk finnes.
   */
  function getLearningGoals(themeId, ageGroup) {
    const themeGoals = NFF_LEARNING_GOALS[themeId];
    if (!themeGoals) return [];
    if (themeGoals[ageGroup]) return themeGoals[ageGroup];
    // Fallback: prøv eldre aldersgrupper
    const fallback = ['6-7', '8-9', '10-12', '13-16'];
    const idx = fallback.indexOf(ageGroup);
    for (let i = idx - 1; i >= 0; i--) {
      if (themeGoals[fallback[i]]) return themeGoals[fallback[i]];
    }
    return [];
  }

  /**
   * Filtrer øvelser basert på aldersgruppe og valgfritt tema.
   * Returnerer sortert liste: relevante først, deretter resten.
   */
  function filterExercisesByContext(ageGroup, themeId) {
    const results = { primary: [], secondary: [], other: [] };
    for (const ex of EXERCISES) {
      if (ex.category === 'special') continue;
      const ageMatch = !ageGroup || (ex.ages && ex.ages.includes(ageGroup));
      const themeMatch = themeId && ex.themes && ex.themes.includes(themeId);

      if (ageMatch && themeMatch) {
        results.primary.push(ex);
      } else if (ageMatch) {
        results.secondary.push(ex);
      } else {
        results.other.push(ex);
      }
    }
    return results;
  }

  /**
   * Beregn NFF-tidsfordeling for en liste med blokker.
   * Returnerer { kategori: minutter } og sammenligner med anbefalt fordeling.
   */
  function calculateNffBalance(blocks, ageGroup) {
    const actual = { sjef_over_ballen: 0, spille_med_og_mot: 0, smalagsspill: 0, scoringstrening: 0 };
    let totalMin = 0;

    for (const block of blocks) {
      const trackA = block.a || block;
      const meta = EX_BY_KEY.get(trackA.exerciseKey);
      if (!meta || meta.category === 'special') continue;
      const cat = meta.nffCategory;
      const minutes = trackA.minutes || meta.defaultMin || 0;
      if (cat && actual.hasOwnProperty(cat)) {
        actual[cat] += minutes;
      }
      totalMin += minutes;

      // Parallell: bruk den lengste varigheten (allerede telt via track A),
      // men kategoriser B-spor separat om det er en annen kategori
      if (block.kind === 'parallel' && block.b) {
        const metaB = EX_BY_KEY.get(block.b.exerciseKey);
        if (metaB && metaB.nffCategory && metaB.nffCategory !== cat) {
          // B-spor kjører samtidig, bidrar til kategori men ikke totaltid
          const minB = block.b.minutes || metaB.defaultMin || 0;
          if (actual.hasOwnProperty(metaB.nffCategory)) {
            actual[metaB.nffCategory] += minB;
          }
        }
      }
    }

    const recommended = NFF_TIME_DISTRIBUTION[ageGroup] || NFF_TIME_DISTRIBUTION['8-9'];
    const balance = {};
    for (const cat of Object.keys(actual)) {
      const actualPct = totalMin > 0 ? Math.round((actual[cat] / totalMin) * 100) : 0;
      const recPct = recommended[cat] || 0;
      balance[cat] = { minutes: actual[cat], actualPct, recommendedPct: recPct, diff: actualPct - recPct };
    }

    return { actual, totalMinutes: totalMin, balance, ageGroup };
  }

  // =========================================================
  // BOTTOM SHEET EXERCISE PICKER
  // Replaces native <select> for exercise selection.
  // Singleton DOM element, shown/hidden with class toggle.
  // =========================================================

  const _bs = {
    el: null,        // root overlay element
    sheet: null,     // sheet panel
    body: null,      // scrollable body
    search: null,    // search input
    blockId: null,   // which block triggered
    track: null,     // 'a' or 'b'
    onSelect: null,  // callback(exerciseKey)
  };

  /** Group exercises by NFF category for bottom sheet display */
  function _bsGroupExercises() {
    const groups = new Map();
    const age = state.ageGroup || null;
    for (const cat of NFF_CATEGORIES) {
      groups.set(cat.id, []);
    }
    for (const ex of EXERCISES) {
      if (ex.category === 'special') continue;
      // Filter by age if set
      if (age && ex.ages && !ex.ages.includes(age)) continue;
      const catId = ex.nffCategory;
      if (groups.has(catId)) {
        groups.get(catId).push(ex);
      }
    }
    return groups;
  }

  /** Get set of exercise keys currently in the session */
  function _bsKeysInSession() {
    const keys = new Set();
    for (const b of state.blocks) {
      if (b.a?.exerciseKey) keys.add(b.a.exerciseKey);
      if (b.kind === 'parallel' && b.b?.exerciseKey) keys.add(b.b.exerciseKey);
    }
    return keys;
  }

  /** Get NFF categories not covered by current session */
  function _bsMissingCategories() {
    const covered = new Set();
    for (const b of state.blocks) {
      const metaA = EX_BY_KEY.get(b.a?.exerciseKey);
      if (metaA && metaA.nffCategory && metaA.nffCategory !== 'pause') covered.add(metaA.nffCategory);
      if (b.kind === 'parallel' && b.b) {
        const metaB = EX_BY_KEY.get(b.b.exerciseKey);
        if (metaB && metaB.nffCategory && metaB.nffCategory !== 'pause') covered.add(metaB.nffCategory);
      }
    }
    return NFF_CATEGORIES.filter(c => !covered.has(c.id));
  }

  /** Create the bottom sheet DOM (once) */
  function _bsCreate() {
    if (_bs.el) return;

    const overlay = document.createElement('div');
    overlay.className = 'wo-bs-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Velg øvelse');

    overlay.innerHTML = `
      <div class="wo-bs-backdrop"></div>
      <div class="wo-bs-sheet">
        <div class="wo-bs-header">
          <div class="wo-bs-drag-handle"></div>
          <div class="wo-bs-title">Velg øvelse</div>
          <button class="wo-bs-close" type="button" aria-label="Lukk">\u2715</button>
        </div>
        <div class="wo-bs-search-wrap">
          <input class="wo-bs-search" type="search" placeholder="S\u00f8k etter \u00f8velse..." autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="wo-bs-pills"></div>
        <div class="wo-bs-drink-wrap">
          <button class="wo-bs-drink-btn" type="button">
            \uD83D\uDCA7 Drikkepause <span class="wo-bs-drink-min">2 min</span>
          </button>
        </div>
        <div class="wo-bs-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    _bs.el = overlay;
    _bs.sheet = overlay.querySelector('.wo-bs-sheet');
    _bs.body = overlay.querySelector('.wo-bs-body');
    _bs.search = overlay.querySelector('.wo-bs-search');

    // Backdrop close
    const backdrop = overlay.querySelector('.wo-bs-backdrop');
    backdrop.addEventListener('click', closeBottomSheet);
    backdrop.style.touchAction = 'none';

    // Close button
    overlay.querySelector('.wo-bs-close').addEventListener('click', closeBottomSheet);

    // Drikkepause button
    overlay.querySelector('.wo-bs-drink-btn').addEventListener('click', () => {
      _bsSelectExercise('drink');
    });

    // Search
    _bs.search.addEventListener('input', _bsFilterSearch);

    // Escape key
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeBottomSheet();
    });

    // Build category pills
    _bsRenderPills();

    console.log('[workout.js] bottom sheet created');
  }

  /** Render category pills */
  function _bsRenderPills() {
    const wrap = _bs.el.querySelector('.wo-bs-pills');
    wrap.innerHTML = NFF_CATEGORIES.map(cat =>
      '<button class="wo-bs-pill" type="button" data-cat="' + cat.id + '"' +
      ' style="--pill-color:' + cat.color + '">' +
      catLabel(cat, state.ageGroup) + '</button>'
    ).join('');

    wrap.querySelectorAll('.wo-bs-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const catId = btn.dataset.cat;
        const section = _bs.body.querySelector('.wo-bs-section[data-cat="' + catId + '"]');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        btn.classList.add('wo-bs-pill-active');
        setTimeout(() => btn.classList.remove('wo-bs-pill-active'), 600);
      });
    });
  }

  /** Render the body content (called each time sheet opens) */
  function _bsRenderBody() {
    const groups = _bsGroupExercises();
    const inSession = _bsKeysInSession();
    const missing = _bsMissingCategories();
    const currentTheme = state.theme || null;
    const favs = loadFavorites();

    let html = '';

    // Missing categories hint
    if (missing.length > 0 && missing.length < NFF_CATEGORIES.length) {
      html += '<div class="wo-bs-hint">';
      html += '<span class="wo-bs-hint-icon">\uD83D\uDCA1</span> ';
      html += 'Mangler i \u00f8kta: ';
      html += missing.map(c => '<strong>' + escapeHtml(catShort(c, state.ageGroup)) + '</strong>').join(', ');
      html += '</div>';
    }

    // Favorites section
    if (favs.size > 0) {
      const age = state.ageGroup || null;
      const favExercises = EXERCISES.filter(ex =>
        ex.category !== 'special' && favs.has(ex.key) &&
        (!age || !ex.ages || ex.ages.includes(age))
      );
      if (favExercises.length > 0) {
        html += '<div class="wo-bs-section wo-bs-section-theme">';
        html += '<div class="wo-bs-section-head wo-bs-section-head-theme">\u2605 Favoritter</div>';
        for (const ex of favExercises) {
          html += _bsRenderCard(ex, inSession, favs);
        }
        html += '</div>';
      }
    }

    // Theme section (if theme is set via generer-flow)
    if (currentTheme) {
      const themeMeta = NFF_THEME_BY_ID[currentTheme];
      if (themeMeta) {
        const age = state.ageGroup || null;
        const themeExercises = EXERCISES.filter(ex =>
          ex.category !== 'special' && ex.themes && ex.themes.includes(currentTheme) &&
          (!age || !ex.ages || ex.ages.includes(age))
        );
        if (themeExercises.length > 0) {
          html += '<div class="wo-bs-section wo-bs-section-theme">';
          html += '<div class="wo-bs-section-head wo-bs-section-head-theme">';
          html += escapeHtml(themeMeta.icon) + ' Passer til \u00ab' + escapeHtml(themeMeta.label) + '\u00bb</div>';
          for (const ex of themeExercises) {
            html += _bsRenderCard(ex, inSession, favs);
          }
          html += '</div>';
        }
      }
    }

    // NFF category sections (favorites sorted first)
    for (const cat of NFF_CATEGORIES) {
      const exs = groups.get(cat.id) || [];
      if (!exs.length) continue;

      // Sort: favorites first, then by frequency
      const freq = loadFrequency();
      exs.sort((a, b) => {
        const fa = favs.has(a.key) ? 1 : 0;
        const fb = favs.has(b.key) ? 1 : 0;
        if (fb !== fa) return fb - fa;
        return (freq[b.key] || 0) - (freq[a.key] || 0);
      });

      html += '<div class="wo-bs-section" data-cat="' + cat.id + '">';
      html += '<div class="wo-bs-section-head" style="--cat-color:' + cat.color + '">';
      html += catLabel(cat, state.ageGroup) + '</div>';

      for (const ex of exs) {
        html += _bsRenderCard(ex, inSession, favs);
      }
      html += '</div>';
    }

    // "Skriv inn selv" at bottom
    html += '<button class="wo-bs-custom-btn" type="button">\u270f\ufe0f Skriv inn selv\u2026</button>';

    _bs.body.innerHTML = html;

    // Bind card clicks (select exercise)
    _bs.body.querySelectorAll('.wo-bs-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.dataset.key;
        if (key) _bsSelectExercise(key);
      });
    });

    // Bind favorite star clicks
    _bs.body.querySelectorAll('.wo-bs-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't select the exercise
        const key = btn.dataset.fav;
        if (key) {
          toggleFavorite(key);
          _bsRenderBody(); // re-render to update stars and sections
        }
      });
    });

    // Bind custom button
    const customBtn = _bs.body.querySelector('.wo-bs-custom-btn');
    if (customBtn) {
      customBtn.addEventListener('click', () => _bsSelectExercise('custom'));
    }
  }

  /** Render a single exercise card */
  function _bsRenderCard(ex, inSession, favs) {
    const cat = NFF_CATEGORY_BY_ID[ex.nffCategory];
    const color = cat ? cat.color : '#888';
    const isInSession = inSession.has(ex.key);
    const isFav = favs && favs.has(ex.key);

    // Description: truncate to ~60 chars
    const desc = ex.description
      ? (ex.description.length > 70 ? ex.description.slice(0, 67) + '\u2026' : ex.description)
      : '';

    // Equipment line (compact)
    const equipLine = ex.equipment
      ? '<div class="wo-bs-card-equip">' + escapeHtml(ex.equipment) + '</div>'
      : '';

    // Meta chips
    const metaParts = [];
    metaParts.push(ex.defaultMin + ' min');
    if (ex.ages && ex.ages.length) {
      if (ex.ages.length > 2) {
        const first = ex.ages[0].split('-')[0];
        const last = ex.ages[ex.ages.length - 1].split('-')[1];
        metaParts.push(first + '\u2013' + last + ' \u00e5r');
      } else {
        metaParts.push(ex.ages.map(a => a + ' \u00e5r').join(', '));
      }
    }
    if (ex.hasOpposition) {
      metaParts.push('<span class="wo-bs-tag-opp">Motspill</span>');
    }

    return '<div class="wo-bs-card' + (isInSession ? ' wo-bs-card-insession' : '') + '"' +
      ' data-key="' + ex.key + '"' +
      ' data-name="' + escapeHtml(ex.label.toLowerCase()) + '"' +
      ' data-desc="' + escapeHtml((ex.description || '').toLowerCase().slice(0, 100)) + '">' +
      '<div class="wo-bs-card-stripe" style="background:' + color + '"></div>' +
      '<div class="wo-bs-card-body">' +
        '<div class="wo-bs-card-name">' + escapeHtml(ex.label) +
          '<button type="button" class="wo-bs-fav" data-fav="' + ex.key + '" title="' + (isFav ? 'Fjern favoritt' : 'Legg til favoritt') + '">' +
            (isFav ? '\u2605' : '\u2606') +
          '</button>' +
        '</div>' +
        (desc ? '<div class="wo-bs-card-desc">' + escapeHtml(desc) + '</div>' : '') +
        equipLine +
        '<div class="wo-bs-card-meta">' + metaParts.join(' \u00b7 ') + '</div>' +
      '</div>' +
      (isInSession ? '<div class="wo-bs-badge">I \u00f8kta</div>' : '') +
    '</div>';
  }

  /** Filter exercises based on search input */
  function _bsFilterSearch() {
    const q = (_bs.search.value || '').trim().toLowerCase();
    const cards = _bs.body.querySelectorAll('.wo-bs-card');
    const sections = _bs.body.querySelectorAll('.wo-bs-section');

    if (!q) {
      cards.forEach(c => { c.style.display = ''; });
      sections.forEach(s => { s.style.display = ''; });
      const cb = _bs.body.querySelector('.wo-bs-custom-btn');
      if (cb) cb.style.display = '';
      return;
    }

    cards.forEach(card => {
      const name = card.dataset.name || '';
      const desc = card.dataset.desc || '';
      const match = name.includes(q) || desc.includes(q);
      card.style.display = match ? '' : 'none';
    });

    // Hide sections where all cards are hidden
    sections.forEach(section => {
      const visible = section.querySelectorAll('.wo-bs-card[style=""], .wo-bs-card:not([style])');
      // More reliable: count non-hidden
      let hasVisible = false;
      section.querySelectorAll('.wo-bs-card').forEach(c => {
        if (c.style.display !== 'none') hasVisible = true;
      });
      section.style.display = hasVisible ? '' : 'none';
    });

    const cb = _bs.body.querySelector('.wo-bs-custom-btn');
    if (cb) cb.style.display = '';
  }

  /** Handle exercise selection */
  function _bsSelectExercise(key) {
    if (_bs.onSelect) {
      _bs.onSelect(key);
    }
    closeBottomSheet();
  }

  /** Open the bottom sheet for a specific block/track */
  function openBottomSheet(blockId, track, onSelect) {
    _bsCreate();

    _bs.blockId = blockId;
    _bs.track = track;
    _bs.onSelect = onSelect;

    _bsRenderBody();

    // Reset search
    _bs.search.value = '';
    _bsFilterSearch();

    // Save scroll position before body lock (iOS fix)
    _bs._savedScrollY = window.scrollY;
    document.body.style.top = '-' + window.scrollY + 'px';

    // Show
    _bs.el.classList.add('wo-bs-open');
    document.body.classList.add('wo-bs-body-lock');

    // Focus search after animation
    setTimeout(() => {
      if (_bs.search) _bs.search.focus({ preventScroll: true });
    }, 300);

    if (_bs.body) _bs.body.scrollTop = 0;
  }

  /** Close the bottom sheet */
  function closeBottomSheet() {
    if (!_bs.el) return;
    _bs.el.classList.remove('wo-bs-open');
    document.body.classList.remove('wo-bs-body-lock');

    // Restore scroll position (iOS fix)
    document.body.style.top = '';
    if (typeof _bs._savedScrollY === 'number') {
      window.scrollTo(0, _bs._savedScrollY);
    }

    _bs.onSelect = null;
    _bs.blockId = null;
    _bs.track = null;
    if (_bs.search) _bs.search.blur();
  }

  // =========================================================
  // TRIGGER BUTTON (replaces <select> in exercise editor)
  // =========================================================

  /** Render trigger button HTML for exercise picker */
  function renderExerciseTrigger(blockId, track, ex) {
    const idp = 'wo_' + blockId + '_' + track;
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';
    const name = displayName(ex);
    const desc = (meta && meta.description)
      ? (meta.description.length > 50 ? meta.description.slice(0, 47) + '\u2026' : meta.description)
      : '';
    const isDrink = ex.exerciseKey === 'drink';

    return '<button type="button" class="wo-trigger" id="' + idp + '_trigger"' +
      ' style="--trigger-color:' + color + '">' +
      '<div class="wo-trigger-stripe"></div>' +
      '<div class="wo-trigger-content">' +
        '<div class="wo-trigger-name">' + (isDrink ? '\uD83D\uDCA7 ' : '') + escapeHtml(name) + '</div>' +
        (desc ? '<div class="wo-trigger-desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
      '<div class="wo-trigger-chevron">Endre \u25be</div>' +
    '</button>';
  }

  // -------------------------
  // SVG Diagram Renderer
  // -------------------------
  // Counter for unique SVG marker IDs (avoids collision when multiple SVGs on same page, e.g. PDF export)
  let _svgIdCounter = 0;

  function renderDrillSVG(diagram) {
    if (!diagram) return '';
    const { width, height, field, elements } = diagram;
    const uid = '_s' + (++_svgIdCounter);
    let s = '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:280px;height:auto;">';
    s += '<defs>';
    s += '<marker id="wo_ap' + uid + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#fff" opacity="0.9"/></marker>';
    s += '<marker id="wo_ar' + uid + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#fff" opacity="0.7"/></marker>';
    s += '<marker id="wo_as' + uid + '" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><path d="M0,0 L10,3.5 L0,7" fill="#FDD835"/></marker>';
    s += '</defs>';
    // Field background
    if (field === 'small' || field === 'quarter') {
      s += '<rect x="8" y="8" width="' + (width - 16) + '" height="' + (height - 16) + '" rx="4" fill="#3d8b37" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>';
    } else if (field === 'half') {
      s += '<rect x="8" y="8" width="' + (width - 16) + '" height="' + (height - 16) + '" rx="4" fill="#3d8b37" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>';
      s += '<line x1="' + (width / 2) + '" y1="8" x2="' + (width / 2) + '" y2="' + (height - 8) + '" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>';
    }
    for (const el of elements) {
      switch (el.type) {
        case 'player': {
          const fill = el.team === 'b' ? '#1E88E5' : el.team === 'neutral' ? '#FF9800' : '#E53935';
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="11" fill="' + fill + '" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>';
          if (el.label) s += '<text x="' + el.x + '" y="' + (el.y + 4) + '" text-anchor="middle" fill="white" font-size="9" font-weight="700" font-family="sans-serif">' + el.label + '</text>';
          break;
        }
        case 'keeper':
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="11" fill="#FDD835" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>';
          s += '<text x="' + el.x + '" y="' + (el.y + 4) + '" text-anchor="middle" fill="#333" font-size="9" font-weight="700" font-family="sans-serif">K</text>';
          break;
        case 'ball':
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="5" fill="white" stroke="#333" stroke-width="1"/>';
          break;
        case 'cone':
          s += '<polygon points="' + el.x + ',' + (el.y - 6) + ' ' + (el.x - 5) + ',' + (el.y + 4) + ' ' + (el.x + 5) + ',' + (el.y + 4) + '" fill="#FF9800" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>';
          break;
        case 'goal': {
          s += '<rect x="' + el.x + '" y="' + el.y + '" width="' + el.w + '" height="' + el.h + '" rx="2" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="1.5"/>';
          if (!el.vertical) {
            for (let nx = el.x + 8; nx < el.x + el.w; nx += 10)
              s += '<line x1="' + nx + '" y1="' + el.y + '" x2="' + nx + '" y2="' + (el.y + el.h) + '" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>';
          }
          break;
        }
        case 'arrow': {
          const [x1, y1] = el.from, [x2, y2] = el.to;
          if (el.style === 'pass')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" marker-end="url(#wo_ap' + uid + ')"/>';
          else if (el.style === 'run')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#wo_ar' + uid + ')"/>';
          else if (el.style === 'shot')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#FDD835" stroke-width="2.5" marker-end="url(#wo_as' + uid + ')"/>';
          break;
        }
        case 'zone_line':
          s += '<line x1="' + el.x1 + '" y1="' + el.y1 + '" x2="' + el.x2 + '" y2="' + el.y2 + '" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="6,4"/>';
          break;
      }
    }
    s += '</svg>';
    return s;
  }

  function pickRandomExerciseKey() {
    const candidates = EXERCISES.filter(x => !x.isCustom && x.category !== 'special');
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx]?.key || 'ssg';
  }

  // -------------------------
  // Storage (tåler Tracking Prevention / private mode)
  // -------------------------
  const _mem = new Map();

  function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch { return _mem.get(key) ?? null; }
  }
  let _storageWarned = false;
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch {
      _mem.set(key, value);
      if (!_storageWarned) {
        _storageWarned = true;
        if (typeof window.showNotification === 'function') {
          window.showNotification('Nettleseren blokkerer lagring. Data lagres kun midlertidig. Eksporter øktfil/PDF for sikker lagring.', 'error');
        }
      }
    }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); }
    catch { _mem.delete(key); }
  }

  function getUserKeyPrefix() {
    try {
      const uid =
        (window.authService && typeof window.authService.getUserId === 'function'
          ? (window.authService.getUserId() || 'anon')
          : 'anon');
      const tid = window._bftTeamId || 'default';
      return `bft:${uid}:${tid}`;
    } catch {
      return 'bft:anon:default';
    }
  }
  function k(suffix) { return `${getUserKeyPrefix()}:${suffix}`; }

  // Lazy-evaluated keys: uid may not be available at IIFE-init (auth is async).
  // Computing per-call ensures correct key even after auth completes.
  function STORE_KEY()    { return k('workout_templates_v1'); }
  function WORKOUTS_KEY() { return k('workout_sessions_v1'); }
  function DRAFT_KEY()    { return k('workout_draft_v1'); }
  function FREQ_KEY()     { return k('exercise_freq_v1'); }
  const SCHEMA_VERSION = 1;

  // Exercise frequency tracking
  function loadFrequency() {
    try {
      const raw = safeGet(FREQ_KEY());
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function trackExerciseUsage(exerciseKey) {
    if (!exerciseKey || exerciseKey === 'drink') return; // don't track drink break
    try {
      const freq = loadFrequency();
      freq[exerciseKey] = (freq[exerciseKey] || 0) + 1;
      safeSet(FREQ_KEY(), JSON.stringify(freq));
    } catch {}
  }

  // Exercise favorites
  function FAV_KEY() { return k('exercise_favorites_v1'); }
  function loadFavorites() {
    try {
      const raw = safeGet(FAV_KEY());
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  }
  function saveFavorites(favs) {
    try { safeSet(FAV_KEY(), JSON.stringify([...favs])); } catch {}
  }
  function toggleFavorite(exerciseKey) {
    const favs = loadFavorites();
    if (favs.has(exerciseKey)) {
      favs.delete(exerciseKey);
    } else {
      favs.add(exerciseKey);
    }
    saveFavorites(favs);
    return favs;
  }
  function getSortedExercises() {
    const freq = loadFrequency();
    const sorted = [...EXERCISES];
    // Drikkepause always first (index 0), then sort rest by frequency desc
    const drink = sorted.findIndex(e => e.key === 'drink');
    const drinkEx = drink >= 0 ? sorted.splice(drink, 1)[0] : null;
    sorted.sort((a, b) => {
      const fa = freq[a.key] || 0;
      const fb = freq[b.key] || 0;
      if (fb !== fa) return fb - fa;
      return a.label.localeCompare(b.label, 'nb');
    });
    if (drinkEx) sorted.unshift(drinkEx);
    return sorted;
  }

  function defaultStore() {
    return { schemaVersion: SCHEMA_VERSION, templates: [] };
  }

  // =========================================================
  // Supabase-backed storage for workouts + templates
  // Draft + frequency stay in localStorage (flyktig data)
  // =========================================================

  function _woGetSb() {
    var sb = window.supabase || window.supabaseClient;
    return (sb && sb.from) ? sb : null;
  }
  function _woGetUid() {
    return window.__BF_getOwnerUid ? window.__BF_getOwnerUid() : (window.authService ? window.authService.getUserId() : null);
  }
  function _woGetTeamId() {
    return window._bftTeamId || (window.__BF_getTeamId ? window.__BF_getTeamId() : 'default');
  }
  function _woGetSeasonId() {
    // Heuristikk: bruk aktiv sesong hvis tilgjengelig
    try { return window._bftCurrentSeasonId || null; } catch { return null; }
  }

  // In-memory cache (populated async, rendered sync)
  const _woCache = {
    templates: [],   // { id, title, blocks, ... } from Supabase
    workouts: [],    // { id, title, blocks, ... } from Supabase
    loaded: false,
    loading: false,
  };

  /** Load templates + workouts from Supabase into cache */
  async function _woLoadFromDb() {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon' || !tid || tid === 'default') return;
    if (_woCache.loading) return;
    _woCache.loading = true;

    try {
      const res = await sb.from('workouts')
        .select('*')
        .eq('user_id', uid)
        .eq('team_id', tid)
        .order('updated_at', { ascending: false });

      if (res.error) throw res.error;

      const rows = res.data || [];
      _woCache.templates = rows.filter(r => r.is_template);
      _woCache.workouts = rows.filter(r => !r.is_template);
      _woCache.loaded = true;

      console.log('[workout.js] Loaded ' + rows.length + ' workouts from db (' + _woCache.templates.length + ' maler, ' + _woCache.workouts.length + ' økter)');

      renderTemplates();
      renderWorkouts();
    } catch (e) {
      console.warn('[workout.js] _woLoadFromDb feilet:', e.message || e);

      // Fallback: vis localStorage-data hvis Supabase ikke er tilgjengelig
      // (f.eks. workouts-tabell finnes ikke enda, eller nettverksfeil)
      if (!_woCache.loaded) {
        const localTpl = loadStore().data.templates || [];
        const localWo = loadWorkoutsStore().data.workouts || [];
        if (localTpl.length || localWo.length) {
          console.log('[workout.js] Bruker localStorage-fallback: ' + localTpl.length + ' maler, ' + localWo.length + ' \u00f8kter');
          _woCache.templates = localTpl.map(t => ({
            id: t.id,
            title: t.title,
            blocks: t.blocks,
            is_template: true,
            created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
            updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
            _local: true
          }));
          _woCache.workouts = localWo.map(w => ({
            id: w.id,
            title: w.title,
            workout_date: w.date || null,
            blocks: w.blocks,
            is_template: false,
            created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
            updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
            _local: true
          }));
          renderTemplates();
          renderWorkouts();
        }
      }
    } finally {
      _woCache.loading = false;
    }
  }

  /** Save a workout/template to Supabase, return row or null */
  async function _woSaveToDb(data) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon') return null;

    const row = {
      user_id: uid,
      team_id: tid,
      title: data.title || null,
      workout_date: data.date || null,
      duration_minutes: data.duration_minutes || null,
      age_group: data.age_group || state.ageGroup || null,
      theme: data.theme || state.theme || null,
      blocks: data.blocks || [],
      is_template: !!data.is_template,
      season_id: data.season_id || null,
      event_id: data.event_id || null,
      source: data.source || 'manual',
      updated_at: new Date().toISOString()
    };

    try {
      if (data.dbId) {
        // Update existing
        const res = await sb.from('workouts').update(row).eq('id', data.dbId).select().single();
        if (res.error) throw res.error;
        return res.data;
      } else {
        // Insert new
        const res = await sb.from('workouts').insert(row).select().single();
        if (res.error) throw res.error;
        return res.data;
      }
    } catch (e) {
      console.error('[workout.js] _woSaveToDb feilet:', e.message || e);
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagring feilet. Prøv igjen.', 'error');
      }
      return null;
    }
  }

  /** Delete a workout/template from Supabase */
  async function _woDeleteFromDb(dbId) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || !dbId) return false;

    try {
      const res = await sb.from('workouts').delete().eq('id', dbId).eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[workout.js] _woDeleteFromDb feilet:', e.message || e);
      return false;
    }
  }

  /** Rename a workout/template in Supabase */
  async function _woRenameInDb(dbId, newTitle) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || !dbId) return false;

    try {
      const res = await sb.from('workouts')
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', dbId).eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[workout.js] _woRenameInDb feilet:', e.message || e);
      return false;
    }
  }

  // === Legacy compatibility: keep localStorage functions for fallback ===
  function loadStore() {
    const raw = safeGet(STORE_KEY());
    if (!raw) return { ok: true, data: defaultStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (!Array.isArray(parsed.templates)) parsed.templates = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultStore(), corrupt: true, error: e };
    }
  }

  function loadWorkoutsStore() {
    const raw = safeGet(WORKOUTS_KEY());
    if (!raw) return { ok: true, data: { workouts: [] }, corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.workouts)) parsed.workouts = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: { workouts: [] }, corrupt: true };
    }
  }

  /** One-time migration: localStorage + user_data → workouts table */
  async function _woMigrateToDb() {
    const tid = _woGetTeamId();
    const migKey = 'bf_wo_migrated_' + tid;
    if (safeGet(migKey)) return;

    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || uid === 'anon' || !tid || tid === 'default') return;

    // Gather templates and workouts from BOTH localStorage and user_data cloud
    let templates = [];
    let workouts = [];

    // Source 1: localStorage
    const localTemplates = loadStore().data.templates || [];
    const localWorkouts = loadWorkoutsStore().data.workouts || [];
    templates.push(...localTemplates);
    workouts.push(...localWorkouts);

    // Source 2: user_data cloud (handles "ny enhet" case where localStorage is empty)
    try {
      if (window._bftCloud && window._bftCloud.loadAll) {
        const cloudRows = await window._bftCloud.loadAll();
        if (cloudRows && Array.isArray(cloudRows)) {
          for (const row of cloudRows) {
            if (row.key === 'workout_templates_v1' && row.value) {
              const cloudStore = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
              if (cloudStore && Array.isArray(cloudStore.templates)) {
                const localIds = new Set(templates.map(t => t.id));
                for (const ct of cloudStore.templates) {
                  if (ct.id && !localIds.has(ct.id)) templates.push(ct);
                }
              }
            }
            if (row.key === 'workout_sessions_v1' && row.value) {
              const cloudStore = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
              if (cloudStore && Array.isArray(cloudStore.workouts)) {
                const localIds = new Set(workouts.map(w => w.id));
                for (const cw of cloudStore.workouts) {
                  if (cw.id && !localIds.has(cw.id)) workouts.push(cw);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[workout.js] Cloud data lesing under migrasjon feilet:', e.message || e);
    }

    if (templates.length === 0 && workouts.length === 0) {
      safeSet(migKey, '1');
      return;
    }

    // Check what's already in workouts table (handles partial migration / other device)
    // Dedup key: title + is_template + created_at (normalized to epoch ms)
    let existingKeys = new Set();
    try {
      const existing = await sb.from('workouts')
        .select('title, is_template, created_at')
        .eq('user_id', uid).eq('team_id', tid);
      if (existing.data) {
        for (const r of existing.data) {
          // Normalize: Supabase returns '2024-03-07T16:40:00+00:00', JS produces '.000Z'
          var epoch = r.created_at ? new Date(r.created_at).getTime() : 0;
          existingKeys.add((r.title || '') + '|' + (r.is_template ? '1' : '0') + '|' + epoch);
        }
      }
    } catch (e) {
      // If we can't check, proceed carefully
      console.warn('[workout.js] Kunne ikke sjekke eksisterende rader:', e.message || e);
    }

    const rows = [];
    for (const t of templates) {
      const createdIso = t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString();
      var epoch = t.createdAt ? new Date(t.createdAt).getTime() : new Date(createdIso).getTime();
      const key = (t.title || 'Mal') + '|1|' + epoch;
      if (existingKeys.has(key)) continue; // allerede migrert
      rows.push({
        user_id: uid,
        team_id: tid,
        title: t.title || 'Mal',
        blocks: t.blocks || [],
        is_template: true,
        source: 'migrated',
        created_at: createdIso,
        updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : createdIso
      });
    }
    for (const w of workouts) {
      const createdIso = w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString();
      var wEpoch = w.createdAt ? new Date(w.createdAt).getTime() : new Date(createdIso).getTime();
      const key = (w.title || '\u00d8kt') + '|0|' + wEpoch;
      if (existingKeys.has(key)) continue; // allerede migrert
      rows.push({
        user_id: uid,
        team_id: tid,
        title: w.title || '\u00d8kt',
        workout_date: w.date || null,
        blocks: w.blocks || [],
        is_template: false,
        source: 'migrated',
        created_at: createdIso,
        updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : createdIso
      });
    }

    if (rows.length === 0) {
      // Alt er allerede migrert (f.eks. fra annen enhet)
      safeSet(migKey, '1');
      return;
    }

    console.log('[workout.js] Migrerer ' + rows.length + ' \u00f8kter/maler til workouts-tabell');

    try {
      // Single insert (no batching) — atomisk: alt eller ingenting
      const res = await sb.from('workouts').insert(rows);
      if (res.error) throw res.error;
      safeSet(migKey, '1');
      console.log('[workout.js] Migrasjon fullf\u00f8rt: ' + rows.length + ' rader');
    } catch (e) {
      console.warn('[workout.js] Migrasjon feilet:', e.message || e);
      // Don't mark as migrated — retry next load
    }
  }

  function loadDraft() {
    const raw = safeGet(DRAFT_KEY());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveDraft(draft) {
    try { safeSet(DRAFT_KEY(), JSON.stringify(draft)); } catch {}
    // Draft er flyktig — lagres kun i localStorage, ikke i Supabase
  }

  // -------------------------
  // Players (from core.js)
  // -------------------------
  function getPlayersSnapshot() {
    const list = Array.isArray(window.players) ? window.players : [];
    // kun aktive spillere
    return list.filter(p => p && p.active !== false).map(p => ({
      id: p.id,
      name: p.name,
      skill: Number(p.skill) || 0,
      goalie: !!p.goalie,
      active: p.active !== false
    }));
  }

  function playerMap(players) {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }

  // -------------------------
  // Workout state
  // -------------------------
  const state = {
    bound: false,
    usePlayers: false,
    selected: new Set(), // oppmøte
    // parallel picks: blockId -> Set(playerId) for track B
    parallelPickB: new Map(),
    // groups cache: key = `${blockId}:${track}` -> groups (array of arrays of player objects)
    groupsCache: new Map(),
    blocks: [],
    expandedBlockId: null, // Hybrid 1: only one block expanded at a time
    theme: null,      // NFF theme id (set by generer-flow, used by bottom sheet)
    ageGroup: null,   // '6-7' | '8-9' | '10-12' (set by generer-flow)
    eventId: null,    // Supabase event UUID (set by sesong-kobling)
    seasonId: null    // Supabase season UUID (set by sesong-kobling)
  };

  function makeDefaultExercise() {
    return {
      exerciseKey: 'tag',
      customName: '',
      minutes: 10,
      groupCount: 1,
      groupMode: 'even', // even | diff | none
      comment: ''
    };
  }

  function makeBlock(kind = 'single') {
    const id = uuid('b_');
    if (kind === 'parallel') {
      return {
        id,
        kind: 'parallel',
        a: makeDefaultExercise(),
        b: { ...makeDefaultExercise(), exerciseKey: 'keeper', minutes: 12 },
        // UI-only: whether player picker panel is open
        _showPickB: false
      };
    }
    return { id, kind: 'single', a: makeDefaultExercise() };
  }

  // -------------------------
  // Rendering helpers
  // -------------------------
  function displayName(ex) {
    if (!ex) return '';
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    if (ex.exerciseKey === 'custom') return String(ex.customName || '').trim() || 'Egendefinert øvelse';
    if (meta) return meta.label;
    return 'Øvelse';
  }

  function totalMinutes() {
    let sum = 0;
    for (const b of state.blocks) {
      if (b.kind === 'parallel') {
        const a = clampInt(b.a?.minutes, 0, 300, 0);
        const bb = clampInt(b.b?.minutes, 0, 300, 0);
        sum += Math.max(a, bb); // parallelt: teller lengste
      } else {
        sum += clampInt(b.a?.minutes, 0, 300, 0);
      }
    }
    return sum;
  }

  function updateTotalUI() {
    // ── Meta-bar: replaces simple "Total tid" with rich overview ──
    const el = $('woMetaBar');
    const total = totalMinutes();
    const blockCount = state.blocks.filter(b => b.a?.exerciseKey !== 'drink').length;

    // NFF balance
    const balance = calculateNffBalance(state.blocks, state.ageGroup || '8-9');

    // Theme pill
    const themeMeta = state.theme ? NFF_THEME_BY_ID[state.theme] : null;
    const themePill = themeMeta
      ? '<span class="wo-meta-theme">' +
          escapeHtml(themeMeta.icon) + ' ' + escapeHtml(themeMeta.label) +
          ' <button type="button" class="wo-meta-theme-x" id="woMetaThemeX" aria-label="Fjern tema">\u2715</button>' +
        '</span>'
      : '';

    // Age class badge
    const ageBadge = state.ageGroup
      ? '<span class="wo-meta-age">' + escapeHtml(state.ageGroup) + ' \u00e5r</span>'
      : '';

    // NFF balance bar
    let balanceHtml = '<div class="wo-meta-balance">';
    for (const cat of NFF_CATEGORIES) {
      const b = balance.balance[cat.id];
      if (!b) continue;
      const pct = balance.totalMinutes > 0 ? Math.round((b.minutes / balance.totalMinutes) * 100) : 0;
      const recPct = b.recommendedPct || 0;
      const _age = state.ageGroup || '8-9';
      balanceHtml += '<div class="wo-meta-bal-seg" style="--bal-color:' + cat.color + '; --bal-pct:' + pct + '%" ' +
        'title="' + escapeHtml(catShort(cat, _age)) + ': ' + b.minutes + ' min (' + pct + '%) \u2014 anbefalt ' + recPct + '%">' +
        '<div class="wo-meta-bal-fill"></div>' +
        '<span class="wo-meta-bal-label">' + escapeHtml(catShort(cat, _age)) + '</span>' +
      '</div>';
    }
    balanceHtml += '</div>';

    if (el) {
      el.innerHTML =
        '<div class="wo-meta-row">' +
          '<div class="wo-meta-total">' + total + '<span class="wo-meta-total-unit">min</span></div>' +
          '<div class="wo-meta-info">' +
            '<span class="wo-meta-count">' + blockCount + ' \u00f8velser</span>' +
            ageBadge +
            themePill +
          '</div>' +
        '</div>' +
        balanceHtml;

      // Bind theme remove
      const themeX = $('woMetaThemeX');
      if (themeX) {
        themeX.addEventListener('click', () => {
          state.theme = null;
          updateTotalUI();
        });
      }
    }

    // Legacy: keep bottom total in sync if it still exists
    const elB = $('woTotalBottom');
    if (elB) elB.textContent = total + ' min';

    // Fallback: update old woTotalTop if meta-bar not yet in DOM
    if (!el) {
      const elTop = $('woTotalTop');
      if (elTop) elTop.textContent = total + ' min';
    }
  }

  function renderPlayersPanel() {
    const panel = $('woPlayersPanel');
    const container = $('woPlayerSelection');
    const countEl = $('woPlayerCount');
    if (!panel || !container || !countEl) return;

    if (!state.usePlayers) {
      panel.style.display = 'none';
      countEl.textContent = '0';
      container.innerHTML = '';
      return;
    }

    panel.style.display = 'block';

    const players = getPlayersSnapshot().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    // fjern valg som ikke eksisterer lenger
    const validIds = new Set(players.map(p => p.id));
    state.selected = new Set(Array.from(state.selected).filter(id => validIds.has(id)));
    const _pcColors = ['#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7','#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4','#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe','#86efac','#fed7aa','#99f6e4'];

    container.innerHTML = players.map((p, i) => {
      const checked = state.selected.has(p.id) ? 'checked' : '';
      return `
        <label class="player-checkbox" style="--pc-color:${_pcColors[i % _pcColors.length]}">
          <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked}>
          <div class="pc-avatar">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</div>
          <div class="pc-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            ${p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : ''}
          </div>
          <div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        </label>
      `;
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-id');
        if (!id) return;
        if (cb.checked) state.selected.add(id);
        else state.selected.delete(id);
        if (countEl) countEl.textContent = String(state.selected.size);

        // grupper blir fort stale når oppmøte endres
        state.groupsCache.clear();
        renderBlocks(); // oppdater visning + counts
      });
    });

    countEl.textContent = String(state.selected.size);
  }

  function optionHtml(selectedKey) {
    // Build grouped dropdown with <optgroup>
    const freq = loadFrequency();
    const drink = EXERCISES.find(e => e.key === 'drink');
    const custom = EXERCISES.find(e => e.key === 'custom');
    let html = '';
    // Drikkepause always first
    if (drink) {
      const sel = drink.key === selectedKey ? 'selected' : '';
      html += '<option value="' + escapeHtml(drink.key) + '" ' + sel + '>' + escapeHtml(drink.label) + '</option>';
    }
    // Grouped exercises
    for (const cat of EXERCISE_CATEGORIES) {
      const exs = EXERCISES.filter(e => e.category === cat.id);
      if (!exs.length) continue;
      // Sort by frequency within category
      exs.sort((a, b) => {
        const fa = freq[a.key] || 0;
        const fb = freq[b.key] || 0;
        if (fb !== fa) return fb - fa;
        return a.label.localeCompare(b.label, 'nb');
      });
      html += '<optgroup label="' + escapeHtml(catLabel(cat, state.ageGroup)) + '">';
      for (const x of exs) {
        const sel = x.key === selectedKey ? 'selected' : '';
        html += '<option value="' + escapeHtml(x.key) + '" ' + sel + '>' + escapeHtml(x.label) + '</option>';
      }
      html += '</optgroup>';
    }
    // Skriv inn selv last
    if (custom) {
      const sel = custom.key === selectedKey ? 'selected' : '';
      html += '<option value="' + escapeHtml(custom.key) + '" ' + sel + '>' + escapeHtml(custom.label) + '</option>';
    }
    return html;
  }

  function renderExerciseEditor(blockId, track, ex) {
    const idp = `wo_${blockId}_${track}`;
    const showCustom = ex.exerciseKey === 'custom';
    const mode = ex.groupMode || 'even';
    const groupCount = clampInt(ex.groupCount, 1, 20, 2);
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    const hasInfo = meta && meta.description && meta.steps;

    return `
      <div class="wo-subcard">
        <div class="wo-subheader">
          <div class="wo-subtitle">${track === 'a' ? 'Øvelse' : 'Parallell øvelse'}</div>
        </div>

        <div class="wo-row">
          <div class="wo-field">
            <label class="wo-label">Velg øvelse</label>
            <div class="wo-select-row">
              ${renderExerciseTrigger(blockId, track, ex)}
            </div>
            ${hasInfo ? `<button type="button" id="${idp}_info" class="wo-info-expand" aria-label="Vis øvelsesinfo">
              <span class="wo-info-expand-text"><span class="wo-info-expand-icon">📖</span> Vis beskrivelse, diagram og trenertips</span>
              <span class="wo-info-expand-chevron">▼</span>
            </button>` : ''}
          </div>

          <div class="wo-field ${showCustom ? '' : 'wo-hidden'}" id="${idp}_customWrap">
            <label class="wo-label">Navn (manuelt)</label>
            <input id="${idp}_custom" class="input wo-input" type="text" value="${escapeHtml(ex.customName || '')}" placeholder="Skriv inn navn på øvelse">
          </div>

          <div class="wo-field wo-minutes">
            <label class="wo-label">Minutter</label>
            <input id="${idp}_min" class="input wo-input" type="number" min="0" max="300" value="${escapeHtml(String(clampInt(ex.minutes, 0, 300, 10)))}">
          </div>
        </div>

        <div id="${idp}_infoPanel" class="wo-info-panel wo-hidden"></div>

        <div class="wo-row">
          <div class="wo-field wo-groups-settings">
            <label class="wo-label">Grupper</label>
            <div class="wo-inline">
              <input id="${idp}_groups" class="input wo-input" type="number" min="1" max="20" value="${escapeHtml(String(groupCount))}" style="max-width:90px;">
              <select id="${idp}_mode" class="input wo-input">
                <option value="none" ${mode === 'none' ? 'selected' : ''}>Ingen inndeling</option>
                <option value="even" ${mode === 'even' ? 'selected' : ''}>Jevne grupper</option>
                <option value="diff" ${mode === 'diff' ? 'selected' : ''}>Grupper etter nivå</option>
              </select>
            </div>
            <div class="small-text" style="opacity:0.85; margin-top:6px;">
              ${track === 'b' ? 'Parallelt: grupper lages på deltakere til denne øvelsen.' : ''}
              ${track === 'a' ? '' : ''}
            </div>
          </div>

          <div class="wo-field wo-group-actions">
            <label class="wo-label">&nbsp;</label>
            <div class="wo-inline" style="justify-content:flex-end;">
              <button id="${idp}_make" class="btn-secondary" type="button"><i class="fas fa-users"></i> Lag grupper</button>
              <button id="${idp}_refresh" class="btn-secondary" type="button"><i class="fas fa-rotate"></i> Refresh</button>
            </div>
          </div>
        </div>

        <div class="wo-row">
          <div class="wo-field">
            <label class="wo-label">Kommentar</label>
            <textarea id="${idp}_comment" class="input wo-input" rows="2" placeholder="Skriv detaljer til øvelsen...">${escapeHtml(ex.comment || '')}</textarea>
          </div>
        </div>

        <div id="${idp}_groupsOut" class="wo-groupsout"></div>
      </div>
    `;
  }

  function renderParallelPicker(block) {
    const bid = block.id;
    const open = !!block._showPickB;
    const players = getPlayersSnapshot().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    const selectedIds = new Set(state.selected);
    const eligible = players.filter(p => selectedIds.has(p.id));

    const setB = state.parallelPickB.get(bid) || new Set();
    // hold kun valide
    const valid = new Set(eligible.map(p => p.id));
    const cleaned = new Set(Array.from(setB).filter(id => valid.has(id)));
    state.parallelPickB.set(bid, cleaned);

    const countB = cleaned.size;
    const countAll = eligible.length;
    const countA = Math.max(0, countAll - countB);

    return `
      <div class="wo-parallel-pick">
        <div class="wo-parallel-pick-head">
          <div>
            <div style="font-weight:800;">Fordel spillere mellom parallelle øvelser</div>
            <div class="small-text" style="opacity:0.85;">
              Øvelse A: <strong>${countA}</strong> • Øvelse B: <strong>${countB}</strong>
              ${countAll === 0 ? ' • (Velg oppmøte først)' : ''}
            </div>
          </div>
          <button id="wo_${bid}_pickToggle" class="btn-small" type="button">
            ${open ? 'Skjul' : 'Velg deltakere til øvelse B'}
          </button>
        </div>

        <div id="wo_${bid}_pickPanel" class="${open ? '' : 'wo-hidden'}">
          <div class="wo-inline" style="margin:8px 0; gap:8px; flex-wrap:wrap;">
            <button id="wo_${bid}_pickGoalies" class="btn-small" type="button">Velg alle keepere</button>
            <button id="wo_${bid}_pickNone" class="btn-small" type="button">Fjern alle</button>
          </div>

          <div class="wo-pick-list">
            ${(() => { const _pcC = ['#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7','#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4','#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe','#86efac','#fed7aa','#99f6e4']; return eligible.map((p, i) => {
              const checked = cleaned.has(p.id) ? 'checked' : '';
              return `
                <label class="player-checkbox" style="--pc-color:${_pcC[i % _pcC.length]}">
                  <input type="checkbox" data-pickb="${escapeHtml(p.id)}" ${checked}>
                  <div class="pc-avatar">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</div>
                  <div class="pc-info">
                    <div class="player-name">${escapeHtml(p.name)}</div>
                    ${p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : ''}
                  </div>
                  <div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
                </label>
              `;
            }).join(''); })()}
          </div>

          <div class="small-text" style="opacity:0.85; margin-top:6px;">
            Tips: Velg keepere til øvelse B (keepertrening). Resten går automatisk til øvelse A.
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================
  // HYBRID 1 LAYOUT — Compact cards with accordion
  // =========================================================

  /**
   * Get the NFF category for a block (based on track A).
   * Returns the NFF_CATEGORIES object or null.
   */
  function _blockNffCategory(block) {
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    if (!meta) return null;
    if (meta.nffCategory === 'pause') return null; // drikkepause has no NFF section
    return NFF_CATEGORY_BY_ID[meta.nffCategory] || null;
  }

  /**
   * Compute section marker data: where NFF category changes between blocks.
   * Returns array of { beforeIndex, cat, minutes } objects.
   */
  function _computeSectionMarkers() {
    const markers = [];
    let prevCatId = null;
    let sectionStart = 0;

    for (let i = 0; i < state.blocks.length; i++) {
      const cat = _blockNffCategory(state.blocks[i]);
      const catId = cat ? cat.id : null;

      if (catId && catId !== prevCatId) {
        // Compute minutes for this new section
        let sectionMin = 0;
        for (let j = i; j < state.blocks.length; j++) {
          const jCat = _blockNffCategory(state.blocks[j]);
          const jCatId = jCat ? jCat.id : null;
          if (j > i && jCatId !== catId) break;
          // Only count blocks that belong to this category
          if (jCatId === catId) {
            const b = state.blocks[j];
            if (b.kind === 'parallel') {
              sectionMin += Math.max(clampInt(b.a?.minutes, 0, 300, 0), clampInt(b.b?.minutes, 0, 300, 0));
            } else {
              sectionMin += clampInt(b.a?.minutes, 0, 300, 0);
            }
          }
        }
        markers.push({ beforeIndex: i, cat, minutes: sectionMin });
      }
      if (catId) prevCatId = catId;
    }
    return markers;
  }

  /**
   * Render a collapsed card for a block.
   */
  function renderCollapsedCard(block, idx) {
    const bid = block.id;
    const isParallel = block.kind === 'parallel';
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';
    const name = displayName(block.a);
    const isDrink = block.a?.exerciseKey === 'drink';
    const minutes = isParallel
      ? Math.max(clampInt(block.a?.minutes, 0, 300, 0), clampInt(block.b?.minutes, 0, 300, 0))
      : clampInt(block.a?.minutes, 0, 300, 0);

    // Badges
    const badges = [];
    if (isParallel) {
      const nameB = displayName(block.b);
      badges.push('<span class="wo-h1-badge wo-h1-badge-par">\u2016 ' + escapeHtml(nameB) + '</span>');
    }
    if (block.a?.groupMode && block.a.groupMode !== 'none' && block.a.groupCount > 1) {
      badges.push('<span class="wo-h1-badge">\uD83D\uDC65 ' + block.a.groupCount + ' gr</span>');
    }
    if ((block.a?.comment || '').trim()) {
      badges.push('<span class="wo-h1-badge">\uD83D\uDCDD</span>');
    }

    return '<div class="wo-h1-card wo-h1-collapsed" data-bid="' + bid + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-main">' +
        '<div class="wo-h1-name">' + (isDrink ? '\uD83D\uDCA7 ' : '') + escapeHtml(name) + '</div>' +
        (badges.length ? '<div class="wo-h1-badges">' + badges.join('') + '</div>' : '') +
      '</div>' +
      '<div class="wo-h1-min" id="wo_' + bid + '_minTap">' + minutes + '<span class="wo-h1-min-unit">min</span></div>' +
    '</div>';
  }

  /**
   * Render an expanded card for a block.
   */
  function renderExpandedCard(block, idx) {
    const bid = block.id;
    const isParallel = block.kind === 'parallel';
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';

    const editorA = renderExerciseEditor(bid, 'a', block.a);
    const editorB = isParallel ? renderParallelPicker(block) + renderExerciseEditor(bid, 'b', block.b) : '';

    const helpText = isParallel
      ? '<div class="small-text" style="opacity:0.85; margin-top:6px;">Parallelt: total tid teller lengste varighet av \u00f8velse A/B.</div>'
      : '';

    return '<div class="wo-h1-card wo-h1-expanded" data-bid="' + bid + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-exp-body">' +
        editorA +
        editorB +
        helpText +
        '<div class="wo-h1-actions">' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_up" title="Flytt opp">\u2191</button>' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_down" title="Flytt ned">\u2193</button>' +
          (isParallel ? '' : '<button class="btn-small" type="button" id="wo_' + bid + '_addParallel" title="Legg til parallell \u00f8velse">\u2016 Parallelt</button>') +
          '<button class="btn-small btn-danger" type="button" id="wo_' + bid + '_del" title="Slett">\uD83D\uDDD1 Slett</button>' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_collapse" title="Lukk">\u25b2 Lukk</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * Render a section marker.
   */
  function renderSectionMarker(cat, minutes) {
    return '<div class="wo-h1-marker" style="--marker-color:' + cat.color + '">' +
      '<span class="wo-h1-marker-label">' + catLabel(cat, state.ageGroup) + '</span>' +
      '<span class="wo-h1-marker-min">' + minutes + ' min</span>' +
    '</div>';
  }

  function renderBlocks() {
    const container = $('woBlocks');
    if (!container) return;

    const markers = _computeSectionMarkers();
    const markerMap = new Map(markers.map(m => [m.beforeIndex, m]));

    let html = '';
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];

      // Insert section marker if needed
      const marker = markerMap.get(i);
      if (marker) {
        html += renderSectionMarker(marker.cat, marker.minutes);
      }

      // Render card (collapsed or expanded)
      const isExpanded = state.expandedBlockId === b.id;
      if (isExpanded) {
        html += renderExpandedCard(b, i);
      } else {
        html += renderCollapsedCard(b, i);
      }
    }

    container.innerHTML = html;

    // Bind events
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      const isExpanded = state.expandedBlockId === b.id;

      if (isExpanded) {
        // Expanded: bind editors + action buttons
        const up = $(`wo_${b.id}_up`);
        const down = $(`wo_${b.id}_down`);
        const del = $(`wo_${b.id}_del`);
        const addPar = $(`wo_${b.id}_addParallel`);
        const collapse = $(`wo_${b.id}_collapse`);

        if (up) up.addEventListener('click', () => moveBlock(b.id, -1));
        if (down) down.addEventListener('click', () => moveBlock(b.id, +1));
        if (del) del.addEventListener('click', () => { state.expandedBlockId = null; deleteBlock(b.id); });
        if (addPar) addPar.addEventListener('click', () => convertToParallel(b.id));
        if (collapse) collapse.addEventListener('click', () => {
          state.expandedBlockId = null;
          renderBlocks();
        });

        bindExerciseEditor(b, 'a');
        if (b.kind === 'parallel') {
          bindParallelPicker(b);
          bindExerciseEditor(b, 'b');
        }
      } else {
        // Collapsed: click to expand
        const card = container.querySelector('.wo-h1-collapsed[data-bid="' + b.id + '"]');
        if (card) {
          card.addEventListener('click', (e) => {
            // Don't expand if user clicked the inline minute tap area
            if (e.target.closest('.wo-h1-min')) return;
            state.expandedBlockId = b.id;
            renderBlocks();
          });
        }

        // Inline minute editing on tap
        const minTap = $(`wo_${b.id}_minTap`);
        if (minTap) {
          minTap.addEventListener('click', (e) => {
            e.stopPropagation();
            _inlineEditMinutes(b, minTap);
          });
        }
      }
    }

    updateTotalUI();
    persistDraft();
  }

  /**
   * Inline minute editing for collapsed cards.
   * Replaces the minute display with an input field.
   */
  function _inlineEditMinutes(block, el) {
    const currentMin = block.kind === 'parallel'
      ? Math.max(clampInt(block.a?.minutes, 0, 300, 0), clampInt(block.b?.minutes, 0, 300, 0))
      : clampInt(block.a?.minutes, 0, 300, 0);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'wo-h1-min-input';
    input.min = '0';
    input.max = '300';
    input.value = String(currentMin);

    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = clampInt(input.value, 0, 300, currentMin);
      block.a.minutes = val;
      if (block.kind === 'parallel' && block.b) {
        // Keep B in sync if it was the longer one
        if (clampInt(block.b.minutes, 0, 300, 0) >= currentMin) {
          block.b.minutes = val;
        }
      }
      renderBlocks();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { input.value = String(currentMin); input.blur(); }
    });
  }

  function renderInfoPanel(exerciseKey) {
    const meta = EX_BY_KEY.get(exerciseKey);
    if (!meta || !meta.description || !meta.steps) return '';
    const tags = [];
    if (meta.ages && meta.ages.length) {
      if (meta.ages.length > 2) {
        const first = meta.ages[0].split('-')[0];
        const last = meta.ages[meta.ages.length - 1].split('-')[1];
        tags.push('📍 ' + first + '\u2013' + last + ' år');
      } else {
        meta.ages.forEach(a => tags.push('📍 ' + a + ' år'));
      }
    }
    if (meta.players) tags.push('👥 ' + meta.players);
    if (meta.equipment) tags.push('⚙️ ' + meta.equipment);
    let html = '<div class="wo-info-content">';
    html += '<p class="wo-info-desc">' + escapeHtml(meta.description) + '</p>';
    if (tags.length) {
      html += '<div class="wo-info-tags">' + tags.map(t => '<span class="wo-info-tag">' + escapeHtml(t) + '</span>').join('') + '</div>';
    }
    // Learning goals (per exercise)
    if (meta.learningGoals && meta.learningGoals.length) {
      html += '<div class="wo-info-section">🎯 Læringsmål</div><ul class="wo-info-coaching">';
      for (const g of meta.learningGoals) html += '<li>' + escapeHtml(g) + '</li>';
      html += '</ul>';
    }
    if (meta.diagram) {
      html += '<div class="wo-info-svg">' + renderDrillSVG(meta.diagram) + '</div>';
    }
    html += '<div class="wo-info-section">Oppsett</div>';
    html += '<p class="wo-info-text">' + escapeHtml(meta.setup || '') + '</p>';
    html += '<div class="wo-info-section">Gjennomføring</div><ol class="wo-info-steps">';
    for (const step of meta.steps) html += '<li>' + escapeHtml(step) + '</li>';
    html += '</ol>';
    if (meta.coaching && meta.coaching.length) {
      html += '<div class="wo-info-section">Coachingpunkter</div><ul class="wo-info-coaching">';
      for (const c of meta.coaching) html += '<li>' + escapeHtml(c) + '</li>';
      html += '</ul>';
    }
    if (meta.variations && meta.variations.length) {
      html += '<div class="wo-info-section">Variasjoner</div>';
      for (const v of meta.variations) html += '<p class="wo-info-variation">🔄 ' + escapeHtml(v) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function bindExerciseEditor(block, track) {
    const bid = block.id;
    const ex = track === 'a' ? block.a : block.b;
    const idp = `wo_${bid}_${track}`;

    const trigger = $(`${idp}_trigger`);
    const customWrap = $(`${idp}_customWrap`);
    const custom = $(`${idp}_custom`);
    const min = $(`${idp}_min`);
    const groups = $(`${idp}_groups`);
    const mode = $(`${idp}_mode`);
    const comment = $(`${idp}_comment`);
    const makeBtn = $(`${idp}_make`);
    const refreshBtn = $(`${idp}_refresh`);
    const infoBtn = $(`${idp}_info`);
    const infoPanel = $(`${idp}_infoPanel`);

    // Info panel toggle (lazy render)
    if (infoBtn && infoPanel) {
      infoBtn.addEventListener('click', () => {
        const isOpen = !infoPanel.classList.contains('wo-hidden');
        if (isOpen) {
          infoPanel.classList.add('wo-hidden');
          infoBtn.classList.remove('wo-info-expand-active');
          const txt = infoBtn.querySelector('.wo-info-expand-text');
          if (txt) txt.innerHTML = '<span class="wo-info-expand-icon">📖</span> Vis beskrivelse, diagram og trenertips';
        } else {
          if (!infoPanel.dataset.rendered) {
            infoPanel.innerHTML = renderInfoPanel(ex.exerciseKey);
            infoPanel.dataset.rendered = '1';
          }
          infoPanel.classList.remove('wo-hidden');
          infoBtn.classList.add('wo-info-expand-active');
          const txt = infoBtn.querySelector('.wo-info-expand-text');
          if (txt) txt.innerHTML = '<span class="wo-info-expand-icon">📖</span> Skjul øvelsesinfo';
        }
      });
    }

    // Trigger button → opens bottom sheet
    if (trigger) {
      trigger.addEventListener('click', () => {
        openBottomSheet(bid, track, (newKey) => {
          ex.exerciseKey = newKey;
          ex._groupCountManual = false; // reset for auto-sizing
          trackExerciseUsage(newKey);
          const meta = EX_BY_KEY.get(newKey);
          if (meta && Number(ex.minutes) <= 0) ex.minutes = meta.defaultMin ?? 10;

          if (newKey === 'custom') {
            if (customWrap) customWrap.classList.remove('wo-hidden');
          } else {
            if (customWrap) customWrap.classList.add('wo-hidden');
            ex.customName = '';
          }

          // grupper stale
          state.groupsCache.delete(`${bid}:${track}`);
          renderBlocks();
        });
      });
    }

    if (custom) {
      custom.addEventListener('input', () => {
        ex.customName = String(custom.value || '');
        persistDraft();
      });
    }

    if (min) {
      min.addEventListener('input', () => {
        ex.minutes = clampInt(min.value, 0, 300, 0);
        updateTotalUI();
        persistDraft();
      });
    }

    if (groups) {
      groups.addEventListener('input', () => {
        ex.groupCount = clampInt(groups.value, 1, 20, 2);
        ex._groupCountManual = true; // user explicitly set group count
        // grupper stale
        state.groupsCache.delete(`${bid}:${track}`);
        persistDraft();
      });
    }

    if (mode) {
      mode.addEventListener('change', () => {
        ex.groupMode = String(mode.value || 'even');
        state.groupsCache.delete(`${bid}:${track}`);
        persistDraft();
      });
    }

    if (comment) {
      comment.addEventListener('input', () => {
        ex.comment = String(comment.value || '');
        persistDraft();
      });
    }

    if (makeBtn) makeBtn.addEventListener('click', () => {
      computeGroupsFor(block, track, false);
    });
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      computeGroupsFor(block, track, true);
    });

    // re-render cached groups if exists
    renderGroupsOut(bid, track);
  }

  function bindParallelPicker(block) {
    const bid = block.id;
    const toggle = $(`wo_${bid}_pickToggle`);
    const panel = $(`wo_${bid}_pickPanel`);
    const goaliesBtn = $(`wo_${bid}_pickGoalies`);
    const noneBtn = $(`wo_${bid}_pickNone`);

    if (toggle) toggle.addEventListener('click', () => {
      block._showPickB = !block._showPickB;
      renderBlocks();
    });

    const players = getPlayersSnapshot();
    const map = playerMap(players);

    if (goaliesBtn) goaliesBtn.addEventListener('click', () => {
      const set = new Set(state.parallelPickB.get(bid) || []);
      for (const id of state.selected) {
        const p = map.get(id);
        if (p && p.goalie) set.add(id);
      }
      state.parallelPickB.set(bid, set);
      state.groupsCache.delete(`${bid}:a`);
      state.groupsCache.delete(`${bid}:b`);
      renderBlocks();
    });

    if (noneBtn) noneBtn.addEventListener('click', () => {
      state.parallelPickB.set(bid, new Set());
      state.groupsCache.delete(`${bid}:a`);
      state.groupsCache.delete(`${bid}:b`);
      renderBlocks();
    });

    if (panel) {
      panel.querySelectorAll('input[type="checkbox"][data-pickb]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-pickb');
          const set = new Set(state.parallelPickB.get(bid) || []);
          if (cb.checked) set.add(id);
          else set.delete(id);
          state.parallelPickB.set(bid, set);
          // grupper stale
          state.groupsCache.delete(`${bid}:a`);
          state.groupsCache.delete(`${bid}:b`);
          renderBlocks();
        });
      });
    }
  }

  // -------------------------
  // Group computation (reuses core.js algorithms)
  // -------------------------
  function getParticipantsFor(block, track) {
    if (!state.usePlayers) return [];
    const players = getPlayersSnapshot();
    const map = playerMap(players);

    const selectedPlayers = Array.from(state.selected).map(id => map.get(id)).filter(Boolean);

    if (block.kind !== 'parallel') return selectedPlayers;

    // parallel:
    const setB = state.parallelPickB.get(block.id) || new Set();
    if (track === 'b') {
      return selectedPlayers.filter(p => setB.has(p.id));
    }
    // track a = remaining
    return selectedPlayers.filter(p => !setB.has(p.id));
  }

  function computeGroupsFor(block, track, isRefresh) {
    const bid = block.id;
    const ex = track === 'a' ? block.a : block.b;
    const outKey = `${bid}:${track}`;
    const idp = `wo_${bid}_${track}`;

    const groupsOut = $(`wo_${bid}_${track}_groupsOut`);
    if (!groupsOut) return;

    // ikke valgt spillere => ingen grupper (men ikke error)
    if (!state.usePlayers) {
      groupsOut.innerHTML = `<div class="small-text" style="opacity:0.85;">Slå på "Velg spillere til økta" for gruppeinndeling.</div>`;
      return;
    }

    const participants = getParticipantsFor(block, track);
    if (participants.length < 1) {
      groupsOut.innerHTML = `<div class="small-text" style="opacity:0.85;">Ingen deltakere valgt for denne øvelsen.</div>`;
      return;
    }

    const groupMode = String(ex.groupMode || 'even');
    let groupCount = clampInt(ex.groupCount, 1, 20, 2);

    // Auto-calculate group count from suggestedGroupSize if available
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    if (meta && meta.suggestedGroupSize && meta.suggestedGroupSize >= 2) {
      const autoCount = Math.max(1, Math.ceil(participants.length / meta.suggestedGroupSize));
      // Only auto-set if user hasn't manually overridden (groupCount still at default 2)
      // or if groupCount * suggestedGroupSize is way off from participant count
      if (!ex._groupCountManual) {
        groupCount = autoCount;
        ex.groupCount = autoCount;
        // Update UI input
        const groupInput = $(`${idp}_groups`);
        if (groupInput) groupInput.value = String(autoCount);
      }
    }

    // "none" -> bare vis liste
    if (groupMode === 'none' || groupCount <= 1) {
      state.groupsCache.set(outKey, [participants]);
      renderGroupsOut(bid, track);
      return;
    }

    // Cache: "Lag grupper" gjenbruker eksisterende, "Refresh" tvinger ny inndeling
    if (!isRefresh && state.groupsCache.has(outKey)) {
      renderGroupsOut(bid, track);
      return;
    }

    const alg = window.Grouping;
    if (!alg) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Mangler Grouping (grouping.js). Kan ikke lage grupper.', 'error');
      }
      return;
    }

    const useSkill = isUseSkillEnabled();
    if (groupMode === 'diff' && !useSkill) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Slå på "Bruk ferdighetsnivå" for "Etter nivå"', 'error');
      }
      return;
    }

    let groups = null;
    if (groupMode === 'diff') {
      groups = alg.makeDifferentiatedGroups(participants, groupCount, useSkill);
    } else {
      groups = alg.makeBalancedGroups(participants, groupCount, useSkill);
    }

    if (!groups) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Kunne ikke lage grupper', 'error');
      }
      return;
    }

    state.groupsCache.set(outKey, groups);
    renderGroupsOut(bid, track);
  }

  function renderGroupsOut(blockId, track) {
    const outKey = `${blockId}:${track}`;
    const groupsOut = $(`wo_${blockId}_${track}_groupsOut`);
    if (!groupsOut) return;

    const cached = state.groupsCache.get(outKey);
    if (!cached) {
      groupsOut.innerHTML = '';
      return;
    }

    const groups = Array.isArray(cached) ? cached : [];
    const hasMultiple = groups.length > 1;

    groupsOut.innerHTML = `
      <div class="wo-groups-compact">
        ${hasMultiple ? '<div class="grpdd-hint small-text" style="opacity:0.6; margin-bottom:4px; text-align:center; font-size:11px;"><i class="fas fa-hand-pointer" style="margin-right:3px;"></i> Hold inne for \u00e5 bytte/flytte</div>' : ''}
        ${groups.map((g, idx) => `
          <div class="wo-group-card grpdd-group" data-grpdd-gi="${idx}">
            <div class="wo-group-title grpdd-group" data-grpdd-gi="${idx}">${groups.length === 1 ? 'Deltakere' : `Gruppe ${idx + 1}`} <span style="opacity:0.7;">(${g.length})</span></div>
            <div class="wo-group-names">${g.map((p, pi) => `<span class="wo-group-name grpdd-player" data-grpdd-gi="${idx}" data-grpdd-pi="${pi}">${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>`).join('')}</div>
          </div>
        `).join('')}
      </div>
    `;

    // Attach shared drag-drop (only for multi-group)
    if (hasMultiple && window.GroupDragDrop && window.GroupDragDrop.enable) {
      window.GroupDragDrop.enable(groupsOut, groups, function (updatedGroups) {
        state.groupsCache.set(outKey, updatedGroups);
        renderGroupsOut(blockId, track);
      }, {
        notify: typeof window.showNotification === 'function' ? window.showNotification : function () {}
      });
    }
  }

  // -------------------------
  // Block operations
  // -------------------------
  function addBlock(kind = 'single') {
    const b = makeBlock(kind);
    state.blocks.push(b);
    state.expandedBlockId = b.id; // auto-expand new block
    renderBlocks();
  }

  function clearSession() {
    if (state.blocks.length > 0) {
      const ok = window.confirm('Tøm hele økta og start på nytt?');
      if (!ok) return;
    }
    state.blocks = [];
    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.theme = null;
    state.ageGroup = null;
    state.eventId = null;
    state.seasonId = null;
    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl) dateEl.value = '';
    if (titleEl) titleEl.value = '';
    safeRemove(DRAFT_KEY());
    renderBlocks();
    updateTotalUI();
    if (typeof window.showNotification === 'function') {
      window.showNotification('Økta er tømt. Klar for ny planlegging.', 'info');
    }
  }

  function deleteBlock(blockId) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const ok = window.confirm('Slette denne delen av økta?');
    if (!ok) return;

    const b = state.blocks[idx];
    // rydde cache
    state.groupsCache.delete(`${b.id}:a`);
    state.groupsCache.delete(`${b.id}:b`);
    state.parallelPickB.delete(b.id);

    state.blocks.splice(idx, 1);
    renderBlocks();
  }

  function moveBlock(blockId, delta) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= state.blocks.length) return;
    const [b] = state.blocks.splice(idx, 1);
    state.blocks.splice(next, 0, b);
    renderBlocks();
  }

  function convertToParallel(blockId) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;

    const b = state.blocks[idx];
    if (b.kind === 'parallel') return;

    const ok = window.confirm('Legge til en parallell øvelse i samme tidsblokk? (Total tid teller lengste varighet)');
    if (!ok) return;

    const parallel = makeBlock('parallel');
    // behold eksisterende A-øvelse
    parallel.id = b.id;
    parallel.a = b.a;
    // default B = keeper
    parallel.b.exerciseKey = 'keeper';
    parallel.b.minutes = 12;
    state.blocks[idx] = parallel;

    renderBlocks();
  }

  // -------------------------
  // Templates
  // -------------------------
  function serializeTemplateFromState() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return {
          id: uuid('tplb_'), // new ids to avoid collision when loading
          kind: 'parallel',
          a: { ...b.a },
          b: { ...b.b }
        };
      }
      return { id: uuid('tplb_'), kind: 'single', a: { ...b.a } };
    });

    return {
      id: uuid('tpl_'),
      title: title || (date ? `Trening ${date}` : 'Ny treningsøkt'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks
    };
  }

  function applyTemplateToState(tpl) {
    if (!tpl || !Array.isArray(tpl.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = String(tpl.title || '');
    // dato settes ikke automatisk ved last inn (ofte brukt som mal) – men vi kan beholde dagens verdi
    // (ikke overskriv user input)

    state.blocks = tpl.blocks.map(b => {
      if (b.kind === 'parallel') {
        return {
          id: uuid('b_'),
          kind: 'parallel',
          a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }),
          b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }),
          _showPickB: false
        };
      }
      return { id: uuid('b_'), kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.eventId = null;
    state.seasonId = null;
    renderBlocks();
  }

  function renderTemplates() {
    const wrap = $('woTemplates');
    if (!wrap) return;

    const list = _woCache.templates.slice().sort((a, b) => {
      const ta = a.updated_at || a.created_at || '';
      const tb = b.updated_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    if (!list.length) {
      wrap.innerHTML = '<div class="small-text" style="opacity:0.85;">Ingen maler lagret enn\u00e5.</div>';
      return;
    }

    wrap.innerHTML = list.map(t => {
      const dt = new Date(t.updated_at || t.created_at || Date.now());
      const when = dt.toLocaleString('nb-NO', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      const canEdit = !t._local; // Local-only items can't be renamed/deleted until Supabase loads
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:800;">${escapeHtml(t.title || 'Uten navn')}</div>
            <div class="small-text" style="opacity:0.85;">Sist endret: ${escapeHtml(when)}</div>
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(t.id)}">Last inn</button>
            ${canEdit ? '<button class="btn-small" type="button" data-wo-rename="' + escapeHtml(t.id) + '">Gi nytt navn</button>' : ''}
            ${canEdit ? '<button class="btn-small btn-danger" type="button" data-wo-del="' + escapeHtml(t.id) + '">Slett</button>' : ''}
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const tpl = _woCache.templates.find(x => x.id === id);
        if (!tpl) return;
        applyTemplateToState(tpl);
        if (typeof window.showNotification === 'function') window.showNotification('Mal lastet inn', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-rename]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-rename');
        const tpl = _woCache.templates.find(x => x.id === id);
        if (!tpl) return;
        const name = window.prompt('Nytt navn p\u00e5 malen:', tpl.title || '');
        if (name === null) return;
        const v = String(name).trim();
        if (!v) return;
        const ok = await _woRenameInDb(id, v);
        if (ok) {
          tpl.title = v;
          tpl.updated_at = new Date().toISOString();
          renderTemplates();
          if (typeof window.showNotification === 'function') window.showNotification('Navn oppdatert', 'success');
        }
      });
    });

    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne malen?');
        if (!ok) return;
        const deleted = await _woDeleteFromDb(id);
        if (deleted) {
          _woCache.templates = _woCache.templates.filter(x => x.id !== id);
          renderTemplates();
          if (typeof window.showNotification === 'function') window.showNotification('Mal slettet', 'info');
        }
      });
    });
  }

  async function saveTemplate() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return { kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { kind: 'single', a: { ...b.a } };
    });

    const saved = await _woSaveToDb({
      title: title || (date ? 'Trening ' + date : 'Ny trenings\u00f8kt'),
      blocks,
      is_template: true,
    });

    if (saved) {
      _woCache.templates.unshift(saved);
      renderTemplates();
      if (typeof window.showNotification === 'function') window.showNotification('Mal lagret', 'success');
    } else {
      // Supabase feilet — lagre i localStorage som sikkerhetsnett
      _woFallbackSaveLocal(title || (date ? 'Trening ' + date : 'Ny trenings\u00f8kt'), null, blocks, true);
    }
  }

  /**
   * Fallback: lagre til localStorage når Supabase er utilgjengelig.
   * Dataen plukkes opp av _woMigrateToDb neste gang Supabase fungerer.
   */
  function _woFallbackSaveLocal(title, date, blocks, isTemplate) {
    try {
      if (isTemplate) {
        const store = loadStore().data;
        store.templates.push({
          id: uuid('tpl_'),
          title: title,
          blocks: blocks,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        safeSet(STORE_KEY(), JSON.stringify(store));
        // Reset migration flag so next load migrates this item
        safeRemove('bf_wo_migrated_' + _woGetTeamId());
        // Add to visible cache
        _woCache.templates.unshift({
          id: store.templates[store.templates.length - 1].id,
          title: title, blocks: blocks, is_template: true, _local: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        renderTemplates();
      } else {
        const store = loadWorkoutsStore().data;
        store.workouts.unshift({
          id: uuid('w_'),
          title: title,
          date: date || '',
          blocks: blocks,
          usePlayers: !!state.usePlayers,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        safeSet(WORKOUTS_KEY(), JSON.stringify(store));
        safeRemove('bf_wo_migrated_' + _woGetTeamId());
        _woCache.workouts.unshift({
          id: store.workouts[0].id,
          title: title, workout_date: date, blocks: blocks, is_template: false, _local: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        renderWorkouts();
      }
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagret lokalt (synkroniseres ved neste lasting)', 'success');
      }
    } catch (e) {
      console.error('[workout.js] Lokal fallback-lagring feilet:', e.message || e);
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagring feilet. Eksporter \u00f8kta som PDF for \u00e5 bevare den.', 'error');
      }
    }
  }

  
  // -------------------------
  // Saved workouts (økt-historikk)
  // -------------------------
  
// -------------------------
// Shareable workout file (JSON) — local-only sharing between coaches
// -------------------------
const WORKOUT_FILE_VERSION = 1;

function serializeWorkoutFileFromState() {
  const title = String($('woTitle')?.value || '').trim();
  const date = String($('woDate')?.value || '').trim();

  // Intentionally exclude attendance/player ids (GDPR + variability).
  const blocks = state.blocks.map(b => {
    const out = { kind: b.kind === 'parallel' ? 'parallel' : 'single', a: { ...b.a } };
    if (out.kind === 'parallel') out.b = { ...b.b };
    return out;
  });

  return {
    type: 'bft_workout',
    v: WORKOUT_FILE_VERSION,
    title: title || (date ? `Trening ${date}` : 'Treningsøkt'),
    date: date || '',
    usePlayers: !!state.usePlayers,
    exportedAt: new Date().toISOString(),
    blocks
  };
}

function clampText(v, maxLen) {
  const s = String(v ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function normalizeImportedExercise(ex) {
  const d = makeDefaultExercise();
  const out = { ...d, ...ex };

  // Minutes
  out.minutes = clampInt(out.minutes, 0, 300, d.minutes);

  // Group settings
  out.groupCount = clampInt(out.groupCount, 1, 6, d.groupCount);
  out.groupMode = (out.groupMode === 'diff' || out.groupMode === 'even') ? out.groupMode : d.groupMode;

  // Exercise key — migrate old keys first
  if (out.exerciseKey && KEY_MIGRATION[out.exerciseKey]) {
    const migrated = KEY_MIGRATION[out.exerciseKey];
    if (migrated === 'custom' && !out.customName) {
      // Preserve original name for custom fallback
      const oldMeta = { 'juggle': 'Triksing med ball', 'competitions': 'Konkurranser' };
      out.customName = clampText(oldMeta[out.exerciseKey] || out.exerciseKey, 60);
    }
    out.exerciseKey = migrated;
  }

  const allowedKeys = new Set(EXERCISES.map(x => x.key));
  if (!allowedKeys.has(out.exerciseKey)) {
    // If unknown, treat as custom
    const maybe = clampText(out.exerciseKey, 60);
    out.exerciseKey = 'custom';
    out.customName = clampText(out.customName || maybe || '', 60);
  }

  // Text fields
  out.customName = clampText(out.customName || '', 60);
  out.comment = clampText(out.comment || '', 1200);

  return out;
}

function normalizeImportedBlocks(blocks) {
  const out = [];
  const maxBlocks = 80; // safety cap
  for (const b of (Array.isArray(blocks) ? blocks.slice(0, maxBlocks) : [])) {
    if (!b || (b.kind !== 'single' && b.kind !== 'parallel')) continue;

    if (b.kind === 'parallel') {
      out.push({
        id: uuid('b_'),
        kind: 'parallel',
        a: normalizeImportedExercise(b.a),
        b: normalizeImportedExercise(b.b),
        _showPickB: false
      });
    } else {
      out.push({
        id: uuid('b_'),
        kind: 'single',
        a: normalizeImportedExercise(b.a)
      });
    }
  }
  return out.length ? out : [makeBlock('single')];
}

function applyWorkoutFileToState(fileObj) {
  const titleEl = $('woTitle');
  const dateEl = $('woDate');

  if (titleEl) titleEl.value = clampText(fileObj.title || 'Treningsøkt', 80);
  if (dateEl) dateEl.value = clampText(fileObj.date || '', 20);

  state.usePlayers = !!fileObj.usePlayers;
  const t = $('woUsePlayersToggle');
  if (t) t.checked = !!state.usePlayers;

  // Attendance is intentionally NOT imported
  state.selected = new Set();
  state.parallelPickB.clear();
  state.groupsCache.clear();

  state.blocks = normalizeImportedBlocks(fileObj.blocks);
  state.expandedBlockId = null;
  state.eventId = null;
  state.seasonId = null;

  renderPlayersPanel();
  renderBlocks();
  persistDraft();
}

function makeWorkoutFilename(fileObj) {
  const safeDate = (fileObj.date || '').replace(/[^0-9-]/g, '');
  const base = safeDate ? `treningsokt_${safeDate}` : 'treningsokt';
  return `${base}.json`;
}

function downloadWorkoutFile() {
  const fileObj = serializeWorkoutFileFromState();
  const blob = new Blob([JSON.stringify(fileObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = makeWorkoutFilename(fileObj);
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
  if (typeof window.showNotification === 'function') window.showNotification('Øktfil lastet ned', 'success');
}

async function shareWorkoutFile() {
  const fileObj = serializeWorkoutFileFromState();
  const jsonStr = JSON.stringify(fileObj, null, 2);
  const filename = makeWorkoutFilename(fileObj);

  // Prefer Web Share API (mobile), fallback to download.
  try {
    if (navigator.share && navigator.canShare) {
      const file = new File([jsonStr], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: fileObj.title || 'Treningsøkt',
          text: 'Treningsøkt (øktfil) fra Barnefotballtrener',
          files: [file]
        });
        if (typeof window.showNotification === 'function') window.showNotification('Øktfil delt', 'success');
        return;
      }
    }
  } catch {
    // ignore and fallback
  }

  downloadWorkoutFile();
}

function importWorkoutFileFromPicker() {
  const input = $('woImportFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function handleWorkoutFileInputChange(evt) {
  const input = evt?.target;
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || '');
      const obj = JSON.parse(text);

      if (!obj || obj.type !== 'bft_workout' || Number(obj.v) !== WORKOUT_FILE_VERSION) {
        window.alert('Ugyldig øktfil (feil type/versjon).');
        return;
      }
      if (!Array.isArray(obj.blocks)) {
        window.alert('Ugyldig øktfil (mangler øvelser).');
        return;
      }

      applyWorkoutFileToState(obj);
      if (typeof window.showNotification === 'function') window.showNotification('Økt importert. Husk å lagre hvis du vil beholde den i "Mine økter".', 'success');
    } catch (e) {
      window.alert('Kunne ikke importere øktfil. Sjekk at filen er gyldig JSON.');
    }
  };
  reader.onerror = () => window.alert('Kunne ikke lese filen.');
  reader.readAsText(file);
}

function serializeWorkoutFromState() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      // new ids to avoid collision with draft mapping
      const bid = uuid('wb_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { id: bid, kind: 'single', a: { ...b.a } };
    });

    return {
      id: uuid('w_'),
      title: title || (date ? `Trening ${date}` : 'Treningsøkt'),
      date: date || '',
      usePlayers: !!state.usePlayers,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks
    };
  }

  function applyWorkoutToState(w) {
    if (!w || !Array.isArray(w.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = String(w.title || '');
    // Support both old format (.date) and Supabase format (.workout_date)
    const dateVal = w.workout_date || w.date || '';
    if (dateEl && dateVal) dateEl.value = dateVal;

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();
    state.expandedBlockId = null;
    state.eventId = w.event_id || null;
    state.seasonId = w.season_id || null;
    state.theme = w.theme || null;
    state.ageGroup = w.age_group || w.ageGroup || null;

    state.blocks = w.blocks.map(b => {
      const bid = uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    renderPlayersPanel();
    renderBlocks();
    persistDraft();
  }

  /** Duplicate a saved workout as a new unsaved session */
  function duplicateWorkout(w) {
    if (!w || !Array.isArray(w.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = 'Kopi av ' + String(w.title || 'Trenings\u00f8kt');
    if (dateEl) dateEl.value = ''; // blank date — user sets new date

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();
    state.expandedBlockId = null;
    // Clear event/season links — this is a NEW session
    state.eventId = null;
    state.seasonId = null;
    // Keep theme and age from original
    state.theme = w.theme || null;
    state.ageGroup = w.age_group || w.ageGroup || null;

    state.blocks = w.blocks.map(b => {
      const bid = uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    renderPlayersPanel();
    renderBlocks();
    persistDraft();

    if (typeof window.showNotification === 'function') {
      window.showNotification('\u00d8kt duplisert \u2013 sett ny dato og juster fritt', 'success');
    }
  }

  function renderWorkouts() {
    const wrap = $('woWorkouts');
    if (!wrap) return;

    const list = _woCache.workouts.slice().sort((a, b) => {
      const ta = a.updated_at || a.created_at || '';
      const tb = b.updated_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    if (!list.length) {
      wrap.innerHTML = '<div class="small-text" style="opacity:0.75;">Ingen lagrede \u00f8kter enn\u00e5.</div>';
      return;
    }

    wrap.innerHTML = list.map(w => {
      const dateTxt = w.workout_date ? '<span class="small-text" style="opacity:0.8;">' + escapeHtml(w.workout_date) + '</span>' : '';
      const eventBadge = w.event_id ? ' <span class="wo-h1-badge" style="vertical-align:middle;">\uD83D\uDCC5 Sesong</span>' : '';
      const canEdit = !w._local;
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:900;">${escapeHtml(w.title || 'Trenings\u00f8kt')}${eventBadge}</div>
            ${dateTxt}
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(w.id)}"><i class="fas fa-upload"></i> Last</button>
            <button class="btn-small" type="button" data-wo-dup="${escapeHtml(w.id)}" title="Dupliser som ny \u00f8kt">\uD83D\uDCCB Kopi</button>
            ${canEdit ? '<button class="btn-small" type="button" data-wo-del="' + escapeHtml(w.id) + '"><i class="fas fa-trash"></i> Slett</button>' : ''}
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const w = _woCache.workouts.find(x => x.id === id);
        if (w) applyWorkoutToState(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-dup]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-dup');
        const w = _woCache.workouts.find(x => x.id === id);
        if (w) duplicateWorkout(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne \u00f8kta?');
        if (!ok) return;
        const deleted = await _woDeleteFromDb(id);
        if (deleted) {
          _woCache.workouts = _woCache.workouts.filter(x => x.id !== id);
          renderWorkouts();
        }
      });
    });
  }

  async function saveWorkout() {
    const date = String($('woDate')?.value || '').trim();
    if (!date) {
      const ok = window.confirm('Ingen dato valgt. Vil du lagre \u00f8kta likevel?');
      if (!ok) return;
    }

    const title = String($('woTitle')?.value || '').trim();
    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return { kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { kind: 'single', a: { ...b.a } };
    });

    const saved = await _woSaveToDb({
      title: title || (date ? 'Trening ' + date : 'Trenings\u00f8kt'),
      date: date || null,
      blocks,
      is_template: false,
      event_id: state.eventId || null,
      season_id: state.seasonId || null,
      duration_minutes: totalMinutes() || null,
    });

    if (saved) {
      _woCache.workouts.unshift(saved);
      renderWorkouts();
      if (typeof window.showNotification === 'function') window.showNotification('\u00d8kt lagret', 'success');

      // Notify season.js if linked to event
      if (saved.event_id) {
        window.dispatchEvent(new CustomEvent('workout:saved', {
          detail: { eventId: saved.event_id, workoutId: saved.id }
        }));
      }
    } else {
      // Supabase feilet — lagre i localStorage som sikkerhetsnett
      _woFallbackSaveLocal(title || (date ? 'Trening ' + date : 'Trenings\u00f8kt'), date, blocks, false);
    }
  }


  // -------------------------
  // Pre-built session templates (ferdige øktmaler)
  // -------------------------
  const NFF_TEMPLATES = {
    '6-7': [
      { title: 'Leik og føring (45 min)', theme: 'foering_dribling', duration: 45, blocks: [
        { key: 'tag', min: 8 },
        { key: 'ball_tag', min: 8 },
        { key: 'driving', min: 8 },
        { key: 'drink', min: 2 },
        { key: 'ssg', min: 15 },
        { key: 'shot', min: 4 }
      ]},
      { title: 'Score mål! (45 min)', theme: 'avslutning', duration: 45, blocks: [
        { key: 'tag', min: 6 },
        { key: 'warm_ball', min: 8 },
        { key: 'shot', min: 8 },
        { key: 'drink', min: 2 },
        { key: 'game_activity', min: 18 },
        { key: 'shot_race', min: 3 }
      ]},
      { title: 'Føring og spill (60 min)', theme: 'foering_dribling', duration: 60, blocks: [
        { key: 'ball_tag', min: 8 },
        { key: 'driving', min: 10 },
        { key: 'relay_ball', min: 8 },
        { key: 'drink', min: 2 },
        { key: 'dribble', min: 10 },
        { key: 'ssg', min: 18 },
        { key: 'shot_race', min: 4 }
      ]}
    ],
    '8-9': [
      { title: 'Pasning og samspill (60 min)', theme: 'pasning_samspill', duration: 60, blocks: [
        { key: 'tag', min: 6 },
        { key: 'pass_pair', min: 10 },
        { key: 'pass_move', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'wall_pass', min: 10 },
        { key: 'ssg_theme', min: 18 },
        { key: 'shot', min: 4 }
      ]},
      { title: 'Forsvarsspill (60 min)', theme: 'forsvarsspill', duration: 60, blocks: [
        { key: 'tag', min: 6 },
        { key: 'warm_ball', min: 8 },
        { key: 'defend_press', min: 10 },
        { key: 'drink', min: 2 },
        { key: '1v1', min: 10 },
        { key: 'ssg', min: 20 },
        { key: 'shot_race', min: 4 }
      ]},
      { title: 'Avslutning og mål (75 min)', theme: 'avslutning', duration: 75, blocks: [
        { key: 'tag', min: 8 },
        { key: 'warm_ball', min: 10 },
        { key: 'shot', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'finish_assist', min: 10 },
        { key: '2v1', min: 10 },
        { key: 'ssg', min: 22 },
        { key: 'shot_race', min: 3 }
      ]},
      { title: 'Dribling og 1v1 (60 min)', theme: '1v1_duell', duration: 60, blocks: [
        { key: 'ball_tag', min: 8 },
        { key: 'driving', min: 8 },
        { key: '1v1', min: 10 },
        { key: 'drink', min: 2 },
        { key: '1v1_gates', min: 10 },
        { key: 'ssg', min: 18 },
        { key: 'shot', min: 4 }
      ]}
    ],
    '10-12': [
      { title: 'Spilloppbygging (75 min)', theme: 'spilloppbygging', duration: 75, blocks: [
        { key: 'tag', min: 8 },
        { key: 'rondo_easy', min: 10 },
        { key: 'pass_square', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'possession_dir', min: 15 },
        { key: 'ssg_theme', min: 25 },
        { key: 'shot', min: 5 }
      ]},
      { title: 'Omstilling (75 min)', theme: 'omstilling', duration: 75, blocks: [
        { key: 'tag', min: 8 },
        { key: 'warm_ball', min: 8 },
        { key: 'defend_press', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'transition', min: 15 },
        { key: 'ssg_theme', min: 25 },
        { key: 'shot', min: 7 }
      ]},
      { title: 'Samarbeid og avslutning (90 min)', theme: 'samarbeidsspill', duration: 90, blocks: [
        { key: 'tag', min: 8 },
        { key: 'pass_move', min: 10 },
        { key: 'wall_pass', min: 10 },
        { key: 'drink', min: 2 },
        { key: '3v2', min: 12 },
        { key: 'finish_assist', min: 10 },
        { key: 'ssg_theme', min: 28 },
        { key: 'shot', min: 5 },
        { key: 'drink', min: 2 },
        { key: 'game_activity', min: 3 }
      ]},
      { title: 'Forsvar og pressing (75 min)', theme: 'forsvarsspill', duration: 75, blocks: [
        { key: 'tag', min: 8 },
        { key: 'warm_ball', min: 8 },
        { key: 'defend_press', min: 10 },
        { key: 'drink', min: 2 },
        { key: '2v2', min: 12 },
        { key: 'block_shot', min: 10 },
        { key: 'ssg', min: 22 },
        { key: 'shot', min: 3 }
      ]}
    ],
    '13-16': [
      { title: 'Prepp + Forsvarsspill (90 min)', theme: 'forsvarsspill', duration: 90, blocks: [
        { key: 'prepp', min: 12 },
        { key: 'defend_press', min: 12 },
        { key: 'drink', min: 2 },
        { key: 'sit_defend', min: 15 },
        { key: 'zone_defense', min: 15 },
        { key: 'ssg_theme', min: 28 },
        { key: 'cross_finish', min: 6 }
      ]},
      { title: 'Prepp + Spilloppbygging (90 min)', theme: 'spilloppbygging', duration: 90, blocks: [
        { key: 'prepp', min: 12 },
        { key: 'rondo_easy', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'build_up', min: 15 },
        { key: 'sit_attack', min: 15 },
        { key: 'ssg_theme', min: 30 },
        { key: 'shot', min: 6 }
      ]},
      { title: 'Prepp + Omstilling (75 min)', theme: 'omstilling', duration: 75, blocks: [
        { key: 'prepp', min: 12 },
        { key: 'wall_pass', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'transition', min: 15 },
        { key: 'ssg_theme', min: 28 },
        { key: 'finish_assist', min: 8 }
      ]},
      { title: 'Prepp + Angrep og avslutning (90 min)', theme: 'avslutning', duration: 90, blocks: [
        { key: 'prepp', min: 12 },
        { key: 'pass_square', min: 10 },
        { key: 'drink', min: 2 },
        { key: 'sit_attack', min: 15 },
        { key: 'finish_assist', min: 10 },
        { key: 'ssg_theme', min: 30 },
        { key: 'cross_finish', min: 8 },
        { key: 'drink', min: 2 },
        { key: 'game_activity', min: 1 }
      ]}
    ]
  };

  // Legacy SUGGESTIONS (used as fallback only)
  const SUGGESTIONS = [
    // 60 min
    [
      { key: 'tag', min: 8 },
      { key: 'warm_ball', min: 10 },
      { key: 'pass_pair', min: 10 },
      { key: '1v1', min: 10 },
      { key: 'drink', min: 2 },
      { key: 'ssg', min: 20 }
    ],
    // 75 min (inkl parallel keepertrening)
    [
      { key: 'tag', min: 8 },
      { key: 'warm_ball', min: 10 },
      { key: 'pass_square', min: 12 },
      { key: 'drink', min: 2 },
      { parallel: true, a: { key: '2v1', min: 12 }, b: { key: 'keeper', min: 12 } },
      { key: 'ssg', min: 25 },
      { key: 'shot_race', min: 6 }
    ],
    // 90 min
    [
      { key: 'tag', min: 10 },
      { key: 'warm_ball', min: 12 },
      { key: 'driving', min: 10 },
      { key: 'drink', min: 2 },
      { key: 'receive_turn', min: 12 },
      { key: '3v2', min: 12 },
      { key: 'ssg', min: 28 },
      { key: 'shot', min: 4 }
    ]
  ];

  // =========================================================
  // "LAG EN TRENINGSØKT FOR MEG" — NFF-aware generator
  // =========================================================

  const _gen = {
    open: false,
    selectedTheme: null,
    selectedDuration: 60,
    selectedAge: '8-9',
  };

  /** Render the generer-flow panel */
  function renderGenererFlow() {
    const el = $('woGenererPanel');
    if (!el) return;

    if (!_gen.open) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    // Get available themes for selected age
    const availableThemes = NFF_THEMES_BY_AGE[_gen.selectedAge] || NFF_THEMES_BY_AGE['8-9'];

    // Theme pills
    let themesHtml = '<div class="wo-gen-label">\u00d8ktens tema</div><div class="wo-gen-themes">';
    for (const themeId of availableThemes) {
      const t = NFF_THEME_BY_ID[themeId];
      if (!t) continue;
      const sel = _gen.selectedTheme === themeId ? ' wo-gen-pill-sel' : '';
      themesHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-theme="' + themeId + '">' +
        escapeHtml(t.icon) + ' ' + escapeHtml(t.label) + '</button>';
    }
    themesHtml += '</div>';

    // Learning goals (shown when theme selected)
    let goalsHtml = '';
    if (_gen.selectedTheme) {
      const goals = getLearningGoals(_gen.selectedTheme, _gen.selectedAge);
      if (goals.length) {
        goalsHtml = '<div class="wo-gen-goals">' +
          '<div class="wo-gen-goals-title">\uD83C\uDFAF L\u00e6ringsm\u00e5l</div>' +
          goals.map(g => '<div class="wo-gen-goal">' + escapeHtml(g) + '</div>').join('') +
        '</div>';
      }
    }

    // Age selector
    let ageHtml = '<div class="wo-gen-label">\u00c5rsklasse</div><div class="wo-gen-ages">';
    for (const age of ['6-7', '8-9', '10-12', '13-16']) {
      const sel = _gen.selectedAge === age ? ' wo-gen-pill-sel' : '';
      ageHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-age="' + age + '">' + age + ' \u00e5r</button>';
    }
    ageHtml += '</div>';

    // Duration selector
    let durHtml = '<div class="wo-gen-label">Varighet</div><div class="wo-gen-durations">';
    for (const dur of [45, 60, 75, 90]) {
      const sel = _gen.selectedDuration === dur ? ' wo-gen-pill-sel' : '';
      durHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-dur="' + dur + '">' + dur + ' min</button>';
    }
    durHtml += '</div>';

    // Quick templates for selected age
    const templates = NFF_TEMPLATES[_gen.selectedAge] || [];
    let tplHtml = '';
    if (templates.length) {
      tplHtml = '<div class="wo-gen-label">Ferdige \u00f8ktmaler</div><div class="wo-gen-themes">';
      templates.forEach((tpl, idx) => {
        tplHtml += '<button type="button" class="wo-gen-pill" data-tpl="' + idx + '">\uD83D\uDCCB ' + escapeHtml(tpl.title) + '</button>';
      });
      tplHtml += '</div>';
    }

    el.innerHTML =
      ageHtml +
      tplHtml +
      '<div class="wo-gen-divider" style="border-top:1px solid rgba(255,255,255,0.1);margin:10px 0;padding-top:8px;"><div class="wo-gen-label" style="opacity:0.7">...eller bygg selv:</div></div>' +
      themesHtml +
      goalsHtml +
      durHtml +
      '<button type="button" class="wo-gen-submit" id="woGenSubmit"' +
        (_gen.selectedTheme ? '' : ' disabled') + '>' +
        'Generer trenings\u00f8kt \u2192' +
      '</button>';

    // Bind theme pills
    el.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedTheme = btn.dataset.theme === _gen.selectedTheme ? null : btn.dataset.theme;
        renderGenererFlow();
      });
    });

    // Bind age pills
    el.querySelectorAll('[data-age]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedAge = btn.dataset.age;
        _gen.selectedTheme = null; // reset theme since available themes change
        renderGenererFlow();
      });
    });

    // Bind template pills
    el.querySelectorAll('[data-tpl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpls = NFF_TEMPLATES[_gen.selectedAge] || [];
        const tpl = tpls[parseInt(btn.dataset.tpl, 10)];
        if (!tpl) return;
        loadTemplate(tpl);
        _gen.open = false;
        renderGenererFlow();
      });
    });

    // Bind duration pills
    el.querySelectorAll('[data-dur]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedDuration = parseInt(btn.dataset.dur, 10);
        renderGenererFlow();
      });
    });

    // Bind generate button
    const submit = $('woGenSubmit');
    if (submit) {
      submit.addEventListener('click', () => {
        generateNffWorkout(_gen.selectedTheme, _gen.selectedDuration, _gen.selectedAge);
        _gen.open = false;
        renderGenererFlow();
      });
    }
  }

  /** Toggle generer-flow panel */
  function toggleGenererFlow() {
    _gen.open = !_gen.open;
    renderGenererFlow();

    // Update CTA button state
    const btn = $('woGenererBtn');
    if (btn) {
      btn.classList.toggle('wo-gen-cta-open', _gen.open);
    }
  }

  /**
   * NFF-aware workout generator.
   * Builds a complete workout based on theme, duration, and age group.
   */
  function generateNffWorkout(themeId, durationMin, ageGroup) {
    const dist = NFF_TIME_DISTRIBUTION[ageGroup] || NFF_TIME_DISTRIBUTION['8-9'];
    const drinkMin = 2;
    const available = durationMin - drinkMin;
    const is1316 = ageGroup === '13-16';

    // Calculate minutes per category
    const catMinutes = {};
    let totalPct = 0;
    for (const [cat, pct] of Object.entries(dist)) {
      totalPct += pct;
    }
    for (const [cat, pct] of Object.entries(dist)) {
      catMinutes[cat] = Math.round((pct / totalPct) * available);
    }

    // Find exercises for each category, preferring those matching the theme
    function pickExercise(nffCatId, excludeKeys, preferKey) {
      const candidates = EXERCISES.filter(ex =>
        ex.category !== 'special' &&
        ex.nffCategory === nffCatId &&
        !excludeKeys.has(ex.key) &&
        (!ex.ages || ex.ages.includes(ageGroup))
      );

      // If a specific key is preferred (e.g. 'prepp' for 13-16 oppvarming)
      if (preferKey) {
        const preferred = candidates.find(ex => ex.key === preferKey);
        if (preferred) return preferred;
      }

      // Prefer theme-matching exercises
      const themed = candidates.filter(ex => ex.themes && ex.themes.includes(themeId));
      if (themed.length > 0) return themed[Math.floor(Math.random() * themed.length)];
      if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
      return null;
    }

    const blocks = [];
    const usedKeys = new Set();

    // Category order differs for 13-16 (Prepp → Situasjonsøving → Scoring → Spill)
    // Same categories, but sjef=Prepp, med/mot=Situasjonsøving, spill=Spill
    const categoryOrder = ['sjef_over_ballen', 'spille_med_og_mot', 'scoringstrening', 'smalagsspill'];

    for (const catId of categoryOrder) {
      let remaining = catMinutes[catId] || 0;
      if (remaining <= 0) continue;

      // For 13-16 sjef_over_ballen: prefer 'prepp' exercise
      const preferKey = (is1316 && catId === 'sjef_over_ballen') ? 'prepp' : null;

      // For large allocations, try to pick 2 exercises
      const numExercises = remaining >= 20 ? 2 : 1;
      const perExercise = Math.round(remaining / numExercises);

      for (let i = 0; i < numExercises; i++) {
        const ex = pickExercise(catId, usedKeys, i === 0 ? preferKey : null);
        if (!ex) break;
        usedKeys.add(ex.key);

        const b = makeBlock('single');
        b.a.exerciseKey = ex.key;
        b.a.minutes = i === numExercises - 1 ? (remaining - perExercise * i) : perExercise;
        blocks.push(b);
      }

      // Insert drikkepause after spille_med_og_mot
      if (catId === 'spille_med_og_mot') {
        const drink = makeBlock('single');
        drink.a.exerciseKey = 'drink';
        drink.a.minutes = drinkMin;
        blocks.push(drink);
      }
    }

    // Fallback: if no blocks generated, use old SUGGESTIONS
    if (blocks.length < 2) {
      suggestWorkoutLegacy();
      return;
    }

    state.blocks = blocks;
    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.theme = themeId;
    state.ageGroup = ageGroup;

    renderBlocks();
    if (typeof window.showNotification === 'function') {
      const themeMeta = NFF_THEME_BY_ID[themeId];
      window.showNotification(
        (themeMeta ? themeMeta.label : 'Trenings\u00f8kt') + ' (' + durationMin + ' min) generert \u2013 juster fritt',
        'success'
      );
    }
  }

  /** Legacy suggest (fallback from old SUGGESTIONS array) */
  function suggestWorkoutLegacy() {
    const idx = Math.floor(Math.random() * SUGGESTIONS.length);
    const tpl = SUGGESTIONS[idx];
    loadTemplate({ blocks: tpl.map(s => s.parallel ? s : { key: s.key, min: s.min }), title: 'Forslag' });
  }

  /** Load a pre-built template into the editor */
  function loadTemplate(tpl) {
    const blocks = [];
    for (const step of tpl.blocks) {
      if (step.parallel) {
        const b = makeBlock('parallel');
        b.a.exerciseKey = step.a.key;
        b.a.minutes = step.a.min;
        b.b.exerciseKey = step.b.key;
        b.b.minutes = step.b.min;
        blocks.push(b);
      } else {
        const b = makeBlock('single');
        b.a.exerciseKey = step.key;
        b.a.minutes = step.min;
        blocks.push(b);
      }
    }

    state.blocks = blocks;
    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    if (tpl.theme) state.theme = tpl.theme;
    if (_gen.selectedAge) state.ageGroup = _gen.selectedAge;

    renderBlocks();
    if (typeof window.showNotification === 'function') {
      window.showNotification((tpl.title || '\u00d8ktmal') + ' lastet inn \u2013 juster fritt', 'success');
    }
  }

  // Keep old name for backward compat (button binding)
  function suggestWorkout() {
    // If generer-flow is available, toggle it open instead of random generation
    if ($('woGenererPanel')) {
      toggleGenererFlow();
    } else {
      suggestWorkoutLegacy();
    }
  }

  // -------------------------
  // Export (HTML print -> PDF)
  // -------------------------
  function exportWorkout() {
    const date = String($('woDate')?.value || '').trim();
    const title = String($('woTitle')?.value || '').trim() || (date ? `Trening ${date}` : 'Treningsøkt');
    const total = totalMinutes();
    const includeExInfo = !!($('woExportDetailToggle')?.checked);

    const players = getPlayersSnapshot();
    const map = playerMap(players);
    const selectedPlayers = Array.from(state.selected).map(id => map.get(id)).filter(Boolean);

    function renderGroupLists(block, track) {
      const key = `${block.id}:${track}`;
      const cached = state.groupsCache.get(key);
      if (!cached || !Array.isArray(cached)) return '';
      return `
        <div class="exp-groups"><div class="exp-groups-h">Gruppeinndeling</div>
          ${cached.map((g, i) => `
            <div class="exp-group">
              <div class="exp-group-title">${cached.length === 1 ? 'Deltakere' : `Gruppe ${i + 1}`} (${g.length})</div>
              <div class="exp-group-list">${g.map(p => escapeHtml(p.name)).join(' • ')}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Build table rows with NFF section headers and accumulated minutes
    let prevNffCat = null;
    let accumMin = 0;
    const blocksHtml = state.blocks.map((b, idx) => {
      const isPar = b.kind === 'parallel';
      const minutesA = clampInt(b.a?.minutes, 0, 300, 0);
      const minutesB = isPar ? clampInt(b.b?.minutes, 0, 300, 0) : 0;
      const blockMin = isPar ? Math.max(minutesA, minutesB) : minutesA;
      accumMin += blockMin;

      // NFF section header row
      const metaA = EX_BY_KEY.get(b.a?.exerciseKey);
      const curNffCat = (metaA && metaA.nffCategory !== 'pause') ? metaA.nffCategory : null;
      let sectionRow = '';
      if (curNffCat && curNffCat !== prevNffCat) {
        const catObj = NFF_CATEGORY_BY_ID[curNffCat];
        if (catObj) {
          sectionRow = '<tr class="exp-nff-section"><td colspan="4" style="border-left:3px solid ' + catObj.color + ';padding:6px 12px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:' + catObj.color + ';background:#f9fafb;">' + escapeHtml(catLabel(catObj, state.ageGroup)) + '</td></tr>';
        }
      }
      if (curNffCat) prevNffCat = curNffCat;

      const exAName = displayName(b.a);
      const exBName = isPar ? displayName(b.b) : '';

      const commentA = String(b.a?.comment || '').trim();
      const commentB = isPar ? String(b.b?.comment || '').trim() : '';

      const groupsA = renderGroupLists(b, 'a');
      const groupsB = isPar ? renderGroupLists(b, 'b') : '';

      function renderExInfo(ex) {
        if (!includeExInfo) return '';
        const meta = EX_BY_KEY.get(ex?.exerciseKey);
        if (!meta || !meta.description) return '';
        let info = '';
        info += '<div class="exp-description">' + escapeHtml(meta.description) + '</div>';
        if (meta.equipment) {
          info += '<div class="exp-coaching" style="margin-top:4px;"><span class="exp-coaching-h">Utstyr:</span> ' + escapeHtml(meta.equipment) + '</div>';
        }
        if (meta.setup) {
          info += '<div class="exp-coaching" style="margin-top:4px;"><span class="exp-coaching-h">Oppsett:</span> ' + escapeHtml(meta.setup) + '</div>';
        }
        if (meta.steps && meta.steps.length) {
          info += '<div style="margin-top:4px;"><span class="exp-coaching-h">Gjennomføring:</span><ol style="margin:2px 0 0 16px;padding:0;font-size:12px;line-height:1.5;color:var(--muted);">';
          for (const s of meta.steps) info += '<li>' + escapeHtml(s) + '</li>';
          info += '</ol></div>';
        }
        if (meta.coaching && meta.coaching.length) {
          info += '<div class="exp-coaching"><span class="exp-coaching-h">Tips:</span> ' + meta.coaching.map(c => escapeHtml(c)).join(' \u00b7 ') + '</div>';
        }
        if (meta.diagram) {
          info += '<div class="exp-svg">' + renderDrillSVG(meta.diagram) + '</div>';
        }
        return info;
      }

      const infoA = renderExInfo(b.a);
      const infoB = isPar ? renderExInfo(b.b) : '';

      if (!isPar) {
        return `
          ${sectionRow}
          <tr>
            <td class="exp-col-idx">${idx + 1}</td>
            <td class="exp-col-ex">
              <div class="exp-ex-name">${escapeHtml(exAName)}</div>
              ${infoA}
              ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
              ${groupsA}
            </td>
            <td class="exp-col-min">${blockMin}</td>
            <td class="exp-col-acc">${accumMin}'</td>
          </tr>
        `;
      }

      return `
        ${sectionRow}
        <tr>
          <td class="exp-col-idx">${idx + 1}</td>
          <td class="exp-col-ex">
            <div class="exp-parallel">
              <div class="exp-par">
                <div class="exp-par-h">Øvelse A</div>
                <div class="exp-ex-name">${escapeHtml(exAName)} <span class="exp-mini">(${minutesA} min)</span></div>
                ${infoA}
                ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
                ${groupsA}
              </div>
              <div class="exp-par">
                <div class="exp-par-h">Øvelse B (parallelt)</div>
                <div class="exp-ex-name">${escapeHtml(exBName)} <span class="exp-mini">(${minutesB} min)</span></div>
                ${infoB}
                ${commentB ? `<div class="exp-comment">${escapeHtml(commentB)}</div>` : ''}
                ${groupsB}
              </div>
            </div>
          </td>
          <td class="exp-col-min">${blockMin}</td>
          <td class="exp-col-acc">${accumMin}'</td>
        </tr>
      `;
    }).join('');

    const attendanceHtml = state.usePlayers
      ? `
        <div class="exp-attendance">
          <div class="exp-att-h">Oppmøte (${selectedPlayers.length})</div>
          <div class="exp-att-list">${selectedPlayers.map(p => escapeHtml(p.name)).join(' • ') || '—'}</div>
        </div>
      `
      : '';

    const logoUrl = (() => {
      // Prefer the exact same logo the user sees on the front page (login) for consistent branding.
      // Fallbacks: app header logo -> apple-touch-icon -> icon-192.
      try {
        const front = document.querySelector('.login-logo');
        if (front && front.getAttribute('src')) return new URL(front.getAttribute('src'), window.location.href).href;
        const appLogo = document.querySelector('.app-logo');
        if (appLogo && appLogo.getAttribute('src')) return new URL(appLogo.getAttribute('src'), window.location.href).href;
        return new URL('apple-touch-icon.png', window.location.href).href;
      } catch {
        return 'apple-touch-icon.png';
      }
    })();
    const html = `
<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} – Barnefotballtrener</title>
  <style>
    :root{
      --bg:#0b1220;
      --card:#ffffff;
      --muted:#556070;
      --line:#e6e9ef;
      --brand:#0b5bd3;
      --brand2:#19b0ff;
      --soft:#f6f8fc;
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial; background:var(--soft); color:#111; line-height:1.45;}
    .wrap{max-width:980px; margin:0 auto; padding:18px;}
    .header{
      background: linear-gradient(135deg, var(--brand), var(--brand2));
      color:#fff; border-radius:18px; padding:16px 18px;
      display:flex; gap:14px; align-items:center;
      box-shadow: 0 6px 18px rgba(11,91,211,0.20);
    }
    .logo{width:96px; height:96px; border-radius:14px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden;}
    .logo img{width:96px; height:96px; object-fit:cover;}
    .h-title{font-size:18px; font-weight:900; line-height:1.2;}
    .h-sub{opacity:0.9; font-size:13px; margin-top:2px;}
    .meta{margin-left:auto; text-align:right;}
    .meta .m1{font-weight:800;}
    .meta .m2{opacity:0.9; font-size:13px; margin-top:2px;}
    .card{background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px; margin-top:12px;}
    table{width:100%; border-collapse:separate; border-spacing:0;}
    th,td{vertical-align:top; padding:10px 10px; border-bottom:1px solid var(--line);}
    th{font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); text-align:left;}
    .exp-col-idx{width:44px; color:var(--muted); font-weight:800;}
    .exp-col-min{width:86px; text-align:right; font-weight:900;}
    .exp-col-acc{width:60px; text-align:right; font-weight:700; color:var(--muted); font-size:12px;}
    .exp-ex-name{font-weight:900; margin-bottom:3px;}
    .exp-mini{font-weight:700; color:var(--muted); font-size:12px;}
    .exp-comment{color:var(--muted); font-size:13px; margin-top:6px; margin-bottom:12px; line-height:1.45;}
    .exp-description{color:#374151; font-size:12.5px; margin-top:4px; margin-bottom:6px; line-height:1.5;}
    .exp-coaching{color:var(--muted); font-size:12px; margin-bottom:8px; line-height:1.5;}
    .exp-coaching-h{font-weight:700; color:#374151;}
    .exp-svg{margin:8px 0; display:flex; justify-content:center;}
    .exp-svg svg{max-width:220px; width:100%; height:auto; background:#3d8b37; border-radius:8px; padding:6px;}
    .exp-parallel{display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:6px;}
    .exp-par{border:1px solid var(--line); border-radius:14px; padding:10px; background:#fff;}
    .exp-par-h{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-weight:800; margin-bottom:6px;}
    .exp-groups{margin-top:12px; display:flex; flex-direction:column; gap:10px;}
    .exp-groups-h{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:900; margin-bottom:6px; margin-top:4px;}
    .exp-group{background:var(--soft); border:1px solid var(--line); border-left:4px solid rgba(11,91,211,0.35); border-radius:12px; padding:10px;}
    .exp-group-title{font-weight:900; font-size:13px; color:#1a2333; margin-bottom:6px;}
    .exp-group-list{color:var(--muted); font-size:13px; line-height:1.55;}
    .exp-attendance{margin-top:10px; padding-top:10px; border-top:1px dashed var(--line);}
    .exp-att-h{font-weight:900;}
    .exp-att-list{color:var(--muted); font-size:13px; margin-top:6px; line-height:1.45;}
    .actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;}
    .btn{
      border:0; border-radius:12px; padding:10px 12px; font-weight:800;
      background:var(--brand); color:#fff; cursor:pointer;
    }
    .btn.secondary{background:#1f2a3d;}
    .note{color:var(--muted); font-size:12px; margin-top:8px;}
    .guide{margin-top:12px;}
    .guide-title{font-weight:900; font-size:13px; margin-bottom:8px; color:#1a2333;}
    .guide-steps{display:flex; flex-direction:column; gap:6px;}
    .guide-step{display:flex; align-items:center; gap:8px; font-size:13px; color:#374151; padding:8px 10px; background:var(--soft); border-radius:10px; border-left:3px solid var(--brand);}
    .step-num{background:var(--brand); color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; flex-shrink:0;}
    .step-icon{font-size:16px;}
    .footer{text-align:center; margin-top:20px; font-size:11px; color:var(--muted); padding:10px 0; border-top:1px solid var(--line);}
    tr{page-break-inside:avoid;}
    @media (max-width:720px){
      .exp-parallel{grid-template-columns:1fr;}
      .meta{display:none;}
      th:nth-child(1),td:nth-child(1){display:none;}
      th:nth-child(4),td:nth-child(4),.exp-col-acc{display:none;}
      .exp-col-min{width:70px;}
    }
    @media print{
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{background:#fff;}
      .wrap{max-width:none; padding:0;}
      .actions,.note,.guide{display:none !important;}
      .header{border-radius:0; box-shadow:none;}
      .card{border-radius:0; border-left:0; border-right:0;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo"><img src="${escapeHtml(logoUrl)}" alt="Barnefotballtrener"></div>
      <div>
        <div class="h-title">${escapeHtml(title)}</div>
        <div class="h-sub">${date ? `Dato: ${escapeHtml(date)} \u00b7 ` : ''}Total tid: ${total} min${state.ageGroup ? ` \u00b7 ${escapeHtml(state.ageGroup)} \u00e5r` : ''}</div>
        ${(() => {
          if (!state.theme) return '';
          const tm = NFF_THEME_BY_ID[state.theme];
          if (!tm) return '';
          let s = '<div class="h-sub" style="margin-top:4px;">Tema: <strong>' + escapeHtml(tm.label) + '</strong></div>';
          const goals = getLearningGoals(state.theme, state.ageGroup || '8-9');
          if (goals.length) {
            s += '<div class="h-sub" style="margin-top:2px;font-size:11px;opacity:0.8;">' + goals.map(g => escapeHtml(g)).join(' \u00b7 ') + '</div>';
          }
          return s;
        })()}
      </div>
      <div class="meta">
        <div class="m1">Barnefotballtrener</div>
        <div class="m2">Deling / PDF</div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>\u00d8velse</th>
            <th style="text-align:right;">Min</th>
            <th style="text-align:right;">Akk.</th>
          </tr>
        </thead>
        <tbody>
          ${blocksHtml}
        </tbody>
      </table>
      ${attendanceHtml}
    </div>

    ${(() => {
      // NFF balance bar for PDF
      const bal = calculateNffBalance(state.blocks, state.ageGroup || '8-9');
      if (bal.totalMinutes <= 0) return '';
      let s = '<div class="card" style="margin-top:12px;padding:12px 16px;">';
      s += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:800;margin-bottom:8px;">NFF-fordeling</div>';
      s += '<div style="display:flex;gap:6px;height:28px;">';
      for (const cat of NFF_CATEGORIES) {
        const b = bal.balance[cat.id];
        if (!b) continue;
        const pct = bal.totalMinutes > 0 ? Math.max(5, Math.round((b.minutes / bal.totalMinutes) * 100)) : 0;
        s += '<div style="flex:' + pct + ';background:' + cat.color + '20;border-left:3px solid ' + cat.color + ';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:' + cat.color + ';">' + b.minutes + 'm</div>';
      }
      s += '</div></div>';
      return s;
    })()}

    <div class="card" style="text-align:center; margin-top:16px; padding:12px;">
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:900;">Oppsummering</div>
      <div style="font-size:1.5rem; font-weight:900; margin-top:4px;">Total tid: ${totalMinutes()} min</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="window.print()">Lagre som PDF</button>
      <button class="btn secondary" onclick="window.close()">Lukk</button>
    </div>
    <div class="guide" id="saveGuide"></div>
    <script>
    (function(){
      var ua = navigator.userAgent;
      var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
      var isAndroid = /Android/i.test(ua);
      var g = document.getElementById('saveGuide');
      if (!g) return;
      if (isIOS) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på iPhone/iPad</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Trykk på <b>Del-ikonet</b> <span class="step-icon">↑</span> øverst i Valg-dialogen</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Velg <b>Arkiver i Filer</b> for å lagre PDF-en</div>' +
          '</div>';
      } else if (isAndroid) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på Android</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> som skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Trykk på den gule <b>Last ned</b>-knappen</div>' +
          '</div>';
      } else {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> i stedet for en skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Klikk <b>Lagre</b></div>' +
          '</div>';
      }
    })();
    </script>
    <div class="footer">Laget med Barnefotballtrener.no</div>
  </div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Popup ble blokkert. Tillat popups for å eksportere.', 'error');
      }
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // -------------------------
  // Draft persistence
  // -------------------------
  function persistDraft() {
    const title = String($('woTitle')?.value || '');
    const date = String($('woDate')?.value || '');

    const parallelPickBObj = {};
    for (const [bid, setB] of state.parallelPickB.entries()) {
      parallelPickBObj[bid] = Array.from(setB);
    }

    const draft = {
      version: 2,
      title,
      date,
      theme: state.theme || null,
      ageGroup: state.ageGroup || null,
      usePlayers: !!state.usePlayers,
      selected: Array.from(state.selected),
      parallelPickB: parallelPickBObj,
      blocks: state.blocks.map(b => {
        if (b.kind === 'parallel') {
          return {
            id: b.id,
            kind: 'parallel',
            a: { ...b.a },
            b: { ...b.b }
          };
        }
        return { id: b.id, kind: 'single', a: { ...b.a } };
      })
    };
    saveDraft(draft);
  }

  function restoreDraftIfAny() {
    const draft = loadDraft();
    if (!draft || !Array.isArray(draft.blocks)) return false;

    state.usePlayers = !!draft.usePlayers;
    state.selected = new Set(Array.isArray(draft.selected) ? draft.selected : []);
    if (draft.theme) state.theme = draft.theme;
    if (draft.ageGroup) state.ageGroup = draft.ageGroup;

    // restore title/date (if present)
    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl && typeof draft.date === 'string') dateEl.value = draft.date;
    if (titleEl && typeof draft.title === 'string') titleEl.value = draft.title;

    // restore parallel selections (track B) - keep block ids stable so mapping survives reload
    state.parallelPickB = new Map();
    if (draft.parallelPickB && typeof draft.parallelPickB === 'object') {
      for (const [bid, arr] of Object.entries(draft.parallelPickB)) {
        if (Array.isArray(arr)) state.parallelPickB.set(bid, new Set(arr));
      }
    }

    state.blocks = draft.blocks.map(b => {
      const bid = (b && typeof b.id === 'string' && b.id) ? b.id : uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    return true;
  }

  // =========================================================
  // Help dialogs for Del / Importer
  // =========================================================

  function _woShowHelpDialog(type) {
    // Remove any existing dialog
    const existing = document.querySelector('.wo-help-dialog');
    if (existing) existing.remove();

    const actionsEl = document.querySelector('.wo-actions');
    if (!actionsEl) return;

    const dialog = document.createElement('div');
    dialog.className = 'wo-help-dialog';

    if (type === 'share') {
      dialog.innerHTML =
        '<strong><i class="fas fa-share-from-square" style="margin-right:6px;color:#2563eb;"></i>Del \u00f8kta med medtrener</strong>' +
        '<div>Sender \u00f8kta som en \u00f8ktfil (.json) som medtreneren kan importere i sin egen app.</div>' +
        '<ol>' +
          '<li>Trykk <b>Send \u00f8ktfil</b> under</li>' +
          '<li>Velg SMS, e-post, AirDrop eller annen delingsm\u00e5te</li>' +
          '<li>Medtreneren \u00e5pner filen i Barnefotballtrener og trykker <b>Importer</b></li>' +
        '</ol>' +
        '<div style="font-size:12px;opacity:0.75;margin-top:6px;">\u00d8ktfilen inneholder kun \u00f8velser og tider, ikke spillere. Medtreneren velger egne spillere etter import.</div>' +
        '<div class="wo-help-actions">' +
          '<button class="wo-help-cancel" type="button">Avbryt</button>' +
          '<button class="wo-help-go" type="button"><i class="fas fa-share-from-square" style="margin-right:5px;"></i>Send \u00f8ktfil</button>' +
        '</div>';

      actionsEl.after(dialog);

      dialog.querySelector('.wo-help-cancel').addEventListener('click', () => dialog.remove());
      dialog.querySelector('.wo-help-go').addEventListener('click', () => {
        dialog.remove();
        // Use Web Share if available, otherwise download
        if (navigator.share) {
          shareWorkoutFile();
        } else {
          downloadWorkoutFile();
        }
      });

    } else if (type === 'import') {
      dialog.innerHTML =
        '<strong><i class="fas fa-file-import" style="margin-right:6px;color:#2563eb;"></i>Importer \u00f8kt fra medtrener</strong>' +
        '<div>Har du f\u00e5tt en \u00f8ktfil (.json) fra en medtrener? Importer den her.</div>' +
        '<ol>' +
          '<li>Trykk <b>Velg fil</b> under</li>' +
          '<li>Finn \u00f8ktfilen (.json) du har mottatt</li>' +
          '<li>\u00d8kta lastes inn og du kan justere \u00f8velser og tider</li>' +
        '</ol>' +
        '<div style="font-size:12px;opacity:0.75;margin-top:6px;">Spillere importeres ikke. Velg spillere til \u00f8kta med bryteren over. Husk \u00e5 lagre om du vil ta vare p\u00e5 \u00f8kta.</div>' +
        '<div class="wo-help-actions">' +
          '<button class="wo-help-cancel" type="button">Avbryt</button>' +
          '<button class="wo-help-go" type="button"><i class="fas fa-file-import" style="margin-right:5px;"></i>Velg fil</button>' +
        '</div>';

      actionsEl.after(dialog);

      dialog.querySelector('.wo-help-cancel').addEventListener('click', () => dialog.remove());
      dialog.querySelector('.wo-help-go').addEventListener('click', () => {
        dialog.remove();
        importWorkoutFileFromPicker();
      });
    }
  }

  // -------------------------
  // Init / bind
  // -------------------------
  function initIfPresent() {
    const root = $('workout');
    if (!root) return;

    if (state.bound) return;
    state.bound = true;

    const usePlayersToggle = $('woUsePlayersToggle');
    const addBtn = $('woAddExerciseBtn');
    const addBtnBottom = $('woAddExerciseBtnBottom');
    const suggestBtn = $('woSuggestBtn');
    const saveBtn = $('woSaveTemplateBtn');
    const saveWorkoutBtn = $('woSaveWorkoutBtn');
    const exportBtn = $('woExportBtn');
    const dlJsonBtn = $('woDownloadJsonBtn');
    const shareJsonBtn = $('woShareJsonBtn');
    const importJsonBtn = $('woImportJsonBtn');
    const importFile = $('woImportFile');
    const shareBtn = $('woShareBtn');
    const selectAllBtn = $('woSelectAllBtn');
    const clearAllBtn = $('woClearAllBtn');

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl) dateEl.addEventListener('change', () => persistDraft());
    if (titleEl) titleEl.addEventListener('input', () => persistDraft());


    // restore draft or start with one block
    if (!restoreDraftIfAny()) {
      state.blocks = [makeBlock('single')];
      persistDraft();
    }

    if (usePlayersToggle) {
      usePlayersToggle.checked = !!state.usePlayers;
      usePlayersToggle.addEventListener('change', () => {
        state.usePlayers = !!usePlayersToggle.checked;

        // NB: Vi autovelger ikke spillere. Bruk 'Velg alle' eller velg manuelt.

        state.groupsCache.clear();
        renderPlayersPanel();
        renderBlocks();
      });
    }

    if (addBtn) addBtn.addEventListener('click', () => addBlock('single'));
    if (addBtnBottom) addBtnBottom.addEventListener('click', () => addBlock('single'));
    if (suggestBtn) suggestBtn.addEventListener('click', () => suggestWorkout());

    // Generer-flow CTA button
    const genererBtn = $('woGenererBtn');
    if (genererBtn) {
      genererBtn.addEventListener('click', () => toggleGenererFlow());
      // Inject "Ny økt" button next to generer
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn-secondary';
      clearBtn.style.cssText = 'margin-left:8px;font-size:13px;padding:6px 12px;';
      clearBtn.textContent = '\uD83D\uDDD1 Ny \u00f8kt';
      clearBtn.title = 'T\u00f8m alle \u00f8velser og start p\u00e5 nytt';
      clearBtn.addEventListener('click', clearSession);
      genererBtn.parentNode.insertBefore(clearBtn, genererBtn.nextSibling);
    }
    if (saveBtn) saveBtn.addEventListener('click', () => saveTemplate());
    if (saveWorkoutBtn) saveWorkoutBtn.addEventListener('click', () => saveWorkout());
    if (exportBtn) exportBtn.addEventListener('click', () => exportWorkout());

    // Legacy hidden buttons (keep for backward compat)
    if (dlJsonBtn) dlJsonBtn.addEventListener('click', () => downloadWorkoutFile());
    if (shareJsonBtn) shareJsonBtn.addEventListener('click', () => shareWorkoutFile());

    // "Del med medtrener" — show help dialog first
    if (shareBtn) shareBtn.addEventListener('click', () => {
      _woShowHelpDialog('share');
    });

    // "Importer øktfil" — show help dialog first
    if (importJsonBtn) importJsonBtn.addEventListener('click', () => {
      _woShowHelpDialog('import');
    });
    if (importFile) importFile.addEventListener('change', handleWorkoutFileInputChange);

    // "Mer" dropdown toggle (opens downward)
    const moreBtn = $('woMoreBtn');
    const moreMenu = $('woMoreMenu');
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = moreMenu.style.display === 'block';
        moreMenu.style.display = isOpen ? 'none' : 'block';
      });
      document.addEventListener('click', () => {
        if (moreMenu) moreMenu.style.display = 'none';
      });
      moreMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
      if (!state.usePlayers) return;
      const players = getPlayersSnapshot();
      state.selected = new Set(players.map(p => p.id));
      state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
      if (typeof window.showNotification === 'function') window.showNotification('Valgte alle aktive spillere', 'success');
    });

    if (clearAllBtn) clearAllBtn.addEventListener('click', () => {
      if (!state.usePlayers) return;
      state.selected = new Set();
      state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
      if (typeof window.showNotification === 'function') window.showNotification('Fjernet alle valgte spillere', 'info');
    });

    // Pre-populate cache from localStorage for instant first render
    // (Supabase overwrites later when loadWorkoutCloudData completes)
    if (!_woCache.loaded) {
      const lsTpl = loadStore().data.templates || [];
      const lsWo = loadWorkoutsStore().data.workouts || [];
      if (lsTpl.length || lsWo.length) {
        _woCache.templates = lsTpl.map(t => ({
          id: t.id, title: t.title, blocks: t.blocks, is_template: true,
          created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
          updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
          _local: true  // flag: not yet in Supabase, disable delete/rename
        }));
        _woCache.workouts = lsWo.map(w => ({
          id: w.id, title: w.title, workout_date: w.date || null, blocks: w.blocks, is_template: false,
          created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
          updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
          _local: true
        }));
      }
    }

    // initial render
    renderPlayersPanel();
    renderBlocks();
    renderTemplates();
    renderWorkouts();

    // Keep player UI in sync with core.js
    window.addEventListener('players:updated', () => {
      const players = getPlayersSnapshot();
      const valid = new Set(players.map(p => p.id));

      // Prune selections if players were removed/deactivated in core.js
      const nextSel = new Set();
      for (const id of state.selected) {
        if (valid.has(id)) nextSel.add(id);
      }
      const selectionChanged = nextSel.size !== state.selected.size;
      state.selected = nextSel;

      // Prune track-B picks as well
      for (const [bid, setB] of state.parallelPickB.entries()) {
        const nextB = new Set();
        for (const id of setB) {
          if (valid.has(id)) nextB.add(id);
        }
        state.parallelPickB.set(bid, nextB);
      }

      if (selectionChanged) state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
    });

    console.log('[workout.js] init complete');

    // Re-render team-scoped storage when team changes
    window.addEventListener('team:changed', function(e) {
      try {
        console.log('[workout.js] team:changed', e && e.detail ? e.detail.teamId : '');
        state.groupsCache.clear();
        state.eventId = null;
        state.seasonId = null;

        // Clear cache and pre-populate from new team's localStorage
        _woCache.templates = [];
        _woCache.workouts = [];
        _woCache.loaded = false;
        var lsTpl = loadStore().data.templates || [];
        var lsWo = loadWorkoutsStore().data.workouts || [];
        if (lsTpl.length || lsWo.length) {
          _woCache.templates = lsTpl.map(function(t) {
            return { id: t.id, title: t.title, blocks: t.blocks, is_template: true,
              created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
              updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
              _local: true };
          });
          _woCache.workouts = lsWo.map(function(w) {
            return { id: w.id, title: w.title, workout_date: w.date || null, blocks: w.blocks, is_template: false,
              created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
              updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
              _local: true };
          });
        }

        renderTemplates();
        renderWorkouts();
        restoreDraftIfAny();
        renderPlayersPanel();
        renderBlocks();

        // Last data fra Supabase for nytt lag (migrerer + laster)
        loadWorkoutCloudData();
      } catch (err) {
        console.warn('[workout.js] team:changed handler feilet:', err && err.message ? err.message : err);
      }
    });

    // Auth timing fix: templates/workouts/draft may have been loaded with 'anon'
    // key if auth wasn't ready at DOMContentLoaded. Rehydrate once auth resolves.
    (function rehydrateAfterAuth() {
      const initialPrefix = getUserKeyPrefix();
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const currentPrefix = getUserKeyPrefix();
        if (currentPrefix !== initialPrefix) {
          // Auth resolved with real uid — re-render with correct keys
          clearInterval(timer);
          console.log('[workout.js] auth resolved, rehydrating storage from', initialPrefix, '→', currentPrefix);
          renderTemplates();
          renderWorkouts();
          restoreDraftIfAny();

          // Last cloud-data for treningsøkter
          loadWorkoutCloudData();
        } else if (attempts >= 40) {
          // 40 × 150ms = 6s — give up, auth likely stuck or user is genuinely anon
          clearInterval(timer);
        }
      }, 150);
    })();
  }

  // Load workouts from Supabase (replaces old user_data cloud sync)
  async function loadWorkoutCloudData() {
    try {
      await _woMigrateToDb();
      await _woLoadFromDb();
    } catch (e) {
      console.warn('[workout.js] loadWorkoutCloudData feilet:', e.message || e);
    }
  }

  // =========================================================
  // SESONG-INTEGRASJON: workoutPrefill bridge
  // =========================================================

  /**
   * Pre-fill workout editor from a season training event.
   * Called by season.js when user clicks "Planlegg treningsøkt".
   */
  window.workoutPrefill = function(opts) {
    if (!opts) return;
    console.log('[workout.js] workoutPrefill:', opts.eventId || 'standalone');

    // Set date
    const dateEl = $('woDate');
    if (dateEl && opts.date) dateEl.value = opts.date;

    // Set title
    const titleEl = $('woTitle');
    if (titleEl && opts.title) titleEl.value = opts.title;

    // Set session metadata
    state.ageGroup = opts.ageGroup || state.ageGroup;
    state.theme = opts.theme || null;
    state.eventId = opts.eventId || null;
    state.seasonId = opts.seasonId || null;

    // Set player attendance if provided
    if (opts.playerIds && Array.isArray(opts.playerIds)) {
      state.usePlayers = true;
      state.selected = new Set(opts.playerIds);
      const toggle = $('woUsePlayersToggle');
      if (toggle) toggle.checked = true;
      renderPlayersPanel();
    }

    // If existing workout for this event, load it
    if (opts.eventId && _woCache.loaded) {
      const existing = _woCache.workouts.find(w => w.event_id === opts.eventId);
      if (existing) {
        applyWorkoutToState(existing);
        if (typeof window.showNotification === 'function') {
          window.showNotification('Eksisterende \u00f8kt lastet inn', 'info');
        }
        return;
      }
    }

    // If duration provided, set up generer-flow defaults
    if (opts.duration) {
      _gen.selectedDuration = opts.duration;
    }

    // Render fresh state
    updateTotalUI();
    renderBlocks();
    persistDraft();
  };

  document.addEventListener('DOMContentLoaded', initIfPresent);

})();
