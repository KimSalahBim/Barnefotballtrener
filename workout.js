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
    { key: 'drink', label: 'Drikkepause', defaultMin: 2, category: 'special' },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🏃 OPPVARMING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'tag', label: 'Lek / Sisten', defaultMin: 8, category: 'oppvarming',
      ages: ['6-7','8-9','10-12'], players: '6-20',
      equipment: 'Kjegler til avgrensning, vester til fangere',
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
        'Alle med ball: fangere sparker ballen ut av området',
        'Havsisten: alle må drible med ball'
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
      ages: ['6-7','8-9','10-12'], players: '4-20',
      equipment: '1 ball per spiller, kjegler',
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
      ages: ['8-9','10-12'], players: '5-8',
      equipment: '1 ball, kjegler til firkant',
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
        {type:'arrow',from:[110,20],to:[175,85],style:'pass'},{type:'arrow',from:[110,85],to:[110,30],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ⚽ TEKNIKK
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'driving', label: 'Føring av ball', defaultMin: 10, category: 'teknikk',
      ages: ['6-7','8-9','10-12'], players: '4-16',
      equipment: '1 ball per spiller, 6-10 kjegler',
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
      ages: ['6-7','8-9','10-12'], players: '4-20',
      equipment: '1 ball per par, kjegler som markering',
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
      ages: ['8-9','10-12'], players: '6-12',
      equipment: '2-3 baller, kjegler',
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
        {type:'arrow',from:[110,28],to:[186,132],style:'pass'},
        {type:'arrow',from:[115,38],to:[180,125],style:'run'}
      ]}
    },
    {
      key: 'pass_square', label: 'Pasningsfirkant', defaultMin: 12, category: 'teknikk',
      ages: ['8-9','10-12'], players: '4-12',
      equipment: 'Kjegler, 1-3 baller',
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
        {type:'arrow',from:[55,43],to:[168,38],style:'run'}
      ]}
    },
    {
      key: 'dribble', label: 'Dribling 1 mot 1', defaultMin: 10, category: 'teknikk',
      ages: ['6-7','8-9','10-12'], players: '4-16',
      equipment: 'Baller, småmål eller kjegler, vester',
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
        {type:'cone',x:75,y:55},{type:'cone',x:145,y:55}
      ]}
    },
    {
      key: 'turn', label: 'Vendinger', defaultMin: 10, category: 'teknikk',
      ages: ['8-9','10-12'], players: '4-16',
      equipment: '1 ball per spiller, kjegler',
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
      ages: ['8-9','10-12'], players: '6-12',
      equipment: '1 ball per par, kjegler',
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
        {type:'arrow',from:[45,60],to:[130,60],style:'pass'},
        {type:'arrow',from:[145,50],to:[190,40],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 🎯 AVSLUTNING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: 'shot', label: 'Skudd på mål', defaultMin: 12, category: 'avslutning',
      ages: ['6-7','8-9','10-12'], players: '4-14',
      equipment: 'Mål (stort eller småmål), baller, kjegler',
      description: 'Avslutninger fra ulike posisjoner. Fokus på plassering framfor kraft. Alle barn elsker å skyte på mål — la dem gjøre det mye!',
      setup: 'Mål med keeper (eller åpent med kjegler). Spillere i kø ca. 12-16m fra mål. Baller klare på rekke.',
      steps: [
        'Spilleren fører ball mot mål fra sentralt.',
        'Avslutt på mål fra ca. 10-12 meter.',
        'Neste runde: skudd fra venstre side.',
        'Tredje runde: mottar pasning fra siden og avslutter direkte.'
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
      ages: ['6-7','8-9','10-12'], players: '6-16',
      equipment: 'Mål, baller, kjegler',
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
        {type:'cone',x:65,y:55},{type:'cone',x:65,y:80},{type:'cone',x:65,y:105},
        {type:'player',x:65,y:140,team:'a',label:''},
        {type:'cone',x:155,y:55},{type:'cone',x:155,y:80},{type:'cone',x:155,y:105},
        {type:'player',x:155,y:140,team:'b',label:''},
        {type:'arrow',from:[65,140],to:[65,25],style:'run'},
        {type:'arrow',from:[155,140],to:[155,25],style:'run'}
      ]}
    },

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ⚔️ SPILL MED MOTSTAND
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
      key: '1v1', label: '1 mot 1', defaultMin: 10, category: 'spill_m_motstand',
      ages: ['6-7','8-9','10-12'], players: '4-16',
      equipment: 'Småmål eller kjegler, baller, vester',
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
      ages: ['8-9','10-12'], players: '6-12',
      equipment: 'Småmål eller kjegler, baller',
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
      ages: ['8-9','10-12'], players: '8-15',
      equipment: 'Mål, baller, vester',
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
      ages: ['6-7','8-9','10-12'], players: '6-16',
      equipment: 'Mål (2 stk), vester, baller, kjegler til bane',
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
      ages: ['8-9','10-12'], players: '7-15',
      equipment: 'Vester, baller, kjegler til bane',
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
      ages: ['6-7','8-9','10-12'], players: '6-20',
      equipment: 'Mål, baller, vester',
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
        {type:'player',x:40,y:50,team:'a',label:''},{type:'player',x:80,y:90,team:'a',label:''},
        {type:'player',x:60,y:125,team:'a',label:''},
        {type:'player',x:140,y:40,team:'b',label:''},{type:'player',x:175,y:80,team:'b',label:''},
        {type:'player',x:155,y:120,team:'b',label:''},{type:'ball',x:115,y:78}
      ]}
    },
    {
      key: 'square_game', label: 'Spill i soner', defaultMin: 12, category: 'smalagsspill',
      ages: ['10-12'], players: '8-16',
      equipment: 'Mål, vester, kjegler, baller',
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
      ages: ['8-9','10-12'], players: '1-4',
      equipment: 'Mål, baller, keeperhansker',
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

    // ── EGENDEFINERT (alltid nederst) ──
    { key: 'custom', label: 'Skriv inn selv', defaultMin: 10, isCustom: true, category: 'special' }
  ];

  // Migration map for removed/renamed exercise keys
  const KEY_MIGRATION = {
    'warm_no_ball': 'tag',
    'long_pass': 'pass_pair',
    'pass_turn': 'receive_turn',
    'cross_finish': 'shot',
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
        // Preserve a readable name
        const oldMeta = { 'juggle': 'Triksing med ball', 'competitions': 'Konkurranser' };
        exObj.customName = oldMeta[oldKey] || oldKey;
      }
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

  function loadStore() {
    const raw = safeGet(STORE_KEY());
    if (!raw) return { ok: true, data: defaultStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error('schema');
      if (!Array.isArray(parsed.templates)) parsed.templates = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultStore(), corrupt: true, error: e };
    }
  }

  function saveStore(store) {
    safeSet(STORE_KEY(), JSON.stringify(store));
    if (window._bftCloud) window._bftCloud.save('workout_templates_v1', JSON.stringify(store));
  }

  // Separate store for saved workouts (økt-historikk) to avoid schema migration for templates
  const WORKOUTS_SCHEMA_VERSION = 1;

  function defaultWorkoutsStore() {
    return { schemaVersion: WORKOUTS_SCHEMA_VERSION, workouts: [] };
  }

  function loadWorkoutsStore() {
    const raw = safeGet(WORKOUTS_KEY());
    if (!raw) return { ok: true, data: defaultWorkoutsStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (parsed.schemaVersion !== WORKOUTS_SCHEMA_VERSION) throw new Error('schema');
      if (!Array.isArray(parsed.workouts)) parsed.workouts = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultWorkoutsStore(), corrupt: true, error: e };
    }
  }

  function saveWorkoutsStore(store) {
    safeSet(WORKOUTS_KEY(), JSON.stringify(store));
    if (window._bftCloud) window._bftCloud.save('workout_sessions_v1', JSON.stringify(store));
  }

  function loadDraft() {
    const raw = safeGet(DRAFT_KEY());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveDraft(draft) {
    try { safeSet(DRAFT_KEY(), JSON.stringify(draft)); } catch {}
    if (window._bftCloud) window._bftCloud.save('workout_draft_v1', JSON.stringify(draft));
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
    blocks: []
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
    const t = `${totalMinutes()} min`;
    const el = $('woTotalTop');
    if (el) el.textContent = t;
    const elB = $('woTotalBottom');
    if (elB) elB.textContent = t;
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

    container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:2px;">` + players.map(p => {
      const checked = state.selected.has(p.id) ? 'checked' : '';
      return `
        <label class="player-checkbox" style="padding:4px 6px; gap:6px;">
          <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked}>
          <span class="checkmark" style="width:18px; height:18px;"></span>
          <div class="player-details" style="min-width:0;">
            <div class="player-name" style="font-size:13px;">${escapeHtml(p.name)}</div>
            <div class="player-meta" style="font-size:10px;">${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}</div>
          </div>
        </label>
      `;
    }).join('') + `</div>`;

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
      html += '<optgroup label="' + escapeHtml(cat.label) + '">';
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
    const groupCount = clampInt(ex.groupCount, 1, 6, 2);
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
              <select id="${idp}_sel" class="input wo-input">
                ${optionHtml(ex.exerciseKey)}
              </select>
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
              <input id="${idp}_groups" class="input wo-input" type="number" min="1" max="6" value="${escapeHtml(String(groupCount))}" style="max-width:90px;">
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

          <div class="wo-pick-list" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:2px;">
            ${eligible.map(p => {
              const checked = cleaned.has(p.id) ? 'checked' : '';
              return `
                <label class="player-checkbox wo-pick-item" style="padding:4px 6px; gap:6px;">
                  <input type="checkbox" data-pickb="${escapeHtml(p.id)}" ${checked}>
                  <span class="checkmark" style="width:18px; height:18px;"></span>
                  <div class="player-details" style="min-width:0;">
                    <div class="player-name" style="font-size:13px;">${escapeHtml(p.name)}</div>
                    <div class="player-meta" style="font-size:10px;">${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>

          <div class="small-text" style="opacity:0.85; margin-top:6px;">
            Tips: Velg keepere til øvelse B (keepertrening). Resten går automatisk til øvelse A.
          </div>
        </div>
      </div>
    `;
  }

  function renderBlocks() {
    const container = $('woBlocks');
    if (!container) return;

    container.innerHTML = state.blocks.map((b, idx) => {
      const isParallel = b.kind === 'parallel';
      const header = `
        <div class="wo-block-header">
          <div class="wo-block-title">Del ${idx + 1}${isParallel ? ' • Parallelt' : ''}</div>
          <div class="wo-block-actions">
            <button class="btn-small" type="button" id="wo_${b.id}_up" title="Flytt opp">↑</button>
            <button class="btn-small" type="button" id="wo_${b.id}_down" title="Flytt ned">↓</button>
            ${isParallel ? '' : `<button class="btn-small" type="button" id="wo_${b.id}_addParallel" title="Legg til parallell øvelse">Øvelser parallelt</button>`}
            <button class="btn-small btn-danger" type="button" id="wo_${b.id}_del" title="Slett">Slett</button>
          </div>
        </div>
      `;

      const help = isParallel
        ? `<div class="small-text" style="opacity:0.85; margin-top:6px;">Parallelt: total tid teller lengste varighet av øvelse A/B.</div>`
        : '';

      const body = `
        ${renderExerciseEditor(b.id, 'a', b.a)}
        ${isParallel ? renderParallelPicker(b) + renderExerciseEditor(b.id, 'b', b.b) : ''}
      `;

      return `
        <div class="wo-block${isParallel ? ' wo-block-parallel' : ''}">
          ${header}
          ${help}
          <div class="wo-block-body">
            ${body}
          </div>
        </div>
      `;
    }).join('');

    // bind per-block actions
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];

      const up = $(`wo_${b.id}_up`);
      const down = $(`wo_${b.id}_down`);
      const del = $(`wo_${b.id}_del`);
      const addPar = $(`wo_${b.id}_addParallel`);

      if (up) up.addEventListener('click', () => moveBlock(b.id, -1));
      if (down) down.addEventListener('click', () => moveBlock(b.id, +1));
      if (del) del.addEventListener('click', () => deleteBlock(b.id));
      if (addPar) addPar.addEventListener('click', () => convertToParallel(b.id));

      bindExerciseEditor(b, 'a');
      if (b.kind === 'parallel') {
        bindParallelPicker(b);
        bindExerciseEditor(b, 'b');
      }
    }

    updateTotalUI();
    persistDraft();
  }

  function renderInfoPanel(exerciseKey) {
    const meta = EX_BY_KEY.get(exerciseKey);
    if (!meta || !meta.description || !meta.steps) return '';
    const tags = [];
    if (meta.ages) meta.ages.forEach(a => tags.push('📍 ' + a + ' år'));
    if (meta.players) tags.push('👥 ' + meta.players);
    if (meta.equipment) tags.push('⚙️ ' + meta.equipment);
    let html = '<div class="wo-info-content">';
    html += '<p class="wo-info-desc">' + escapeHtml(meta.description) + '</p>';
    if (tags.length) {
      html += '<div class="wo-info-tags">' + tags.map(t => '<span class="wo-info-tag">' + escapeHtml(t) + '</span>').join('') + '</div>';
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

    const sel = $(`${idp}_sel`);
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
          // Lazy render content
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

    if (sel) {
      sel.addEventListener('change', () => {
        const v = String(sel.value || 'tag');
        ex.exerciseKey = v;
        trackExerciseUsage(v);
        const meta = EX_BY_KEY.get(v);
        if (meta && Number(ex.minutes) <= 0) ex.minutes = meta.defaultMin ?? 10;

        if (v === 'custom') {
          if (customWrap) customWrap.classList.remove('wo-hidden');
        } else {
          if (customWrap) customWrap.classList.add('wo-hidden');
          ex.customName = '';
        }

        // grupper stale
        state.groupsCache.delete(`${bid}:${track}`);
        renderBlocks();
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
        ex.groupCount = clampInt(groups.value, 1, 6, 2);
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
    const groupCount = clampInt(ex.groupCount, 1, 6, 2);

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
    state.blocks.push(makeBlock(kind));
    renderBlocks();
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
    renderBlocks();
  }

  function renderTemplates() {
    const wrap = $('woTemplates');
    if (!wrap) return;

    const storeRes = loadStore();
    const store = storeRes.data;
    const list = store.templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (storeRes.corrupt && typeof window.showNotification === 'function') {
      window.showNotification('⚠️ Lagring av maler var korrupt – startet med tom liste', 'error');
    }

    if (!list.length) {
      wrap.innerHTML = `<div class="small-text" style="opacity:0.85;">Ingen maler lagret ennå.</div>`;
      return;
    }

    wrap.innerHTML = list.map(t => {
      const dt = new Date(t.updatedAt || t.createdAt || Date.now());
      const when = dt.toLocaleString('nb-NO', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:800;">${escapeHtml(t.title || 'Uten navn')}</div>
            <div class="small-text" style="opacity:0.85;">Sist endret: ${escapeHtml(when)}</div>
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(t.id)}">Last inn</button>
            <button class="btn-small" type="button" data-wo-rename="${escapeHtml(t.id)}">Gi nytt navn</button>
            <button class="btn-small btn-danger" type="button" data-wo-del="${escapeHtml(t.id)}">Slett</button>
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const s = loadStore().data;
        const tpl = s.templates.find(x => x.id === id);
        if (!tpl) return;
        applyTemplateToState(tpl);
        if (typeof window.showNotification === 'function') window.showNotification('Mal lastet inn', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-rename');
        const res = loadStore();
        const s = res.data;
        const tpl = s.templates.find(x => x.id === id);
        if (!tpl) return;
        const name = window.prompt('Nytt navn på malen:', tpl.title || '');
        if (name === null) return;
        const v = String(name).trim();
        if (!v) return;
        tpl.title = v;
        tpl.updatedAt = Date.now();
        saveStore(s);
        renderTemplates();
        if (typeof window.showNotification === 'function') window.showNotification('Navn oppdatert', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne malen?');
        if (!ok) return;
        const s = loadStore().data;
        s.templates = s.templates.filter(x => x.id !== id);
        saveStore(s);
        renderTemplates();
        if (typeof window.showNotification === 'function') window.showNotification('Mal slettet', 'info');
      });
    });
  }

  function saveTemplate() {
    const tpl = serializeTemplateFromState();
    const res = loadStore();
    const store = res.data;

    // dedupe title if same (optional)
    store.templates.push(tpl);
    saveStore(store);

    renderTemplates();
    if (typeof window.showNotification === 'function') window.showNotification('Mal lagret', 'success');
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
    if (dateEl && typeof w.date === 'string') dateEl.value = w.date;

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    // attendance is intentionally NOT stored
    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();

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

  function renderWorkouts() {
    const wrap = $('woWorkouts');
    if (!wrap) return;

    const loaded = loadWorkoutsStore();
    const store = loaded.data;

    if (!loaded.ok && loaded.corrupt) {
      wrap.innerHTML = `
        <div class="small-text" style="opacity:0.85;">
          Kunne ikke lese lagrede økter (korrupt data). Ny lagring vil overskrive.
        </div>
      `;
      return;
    }

    const list = store.workouts.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!list.length) {
      wrap.innerHTML = `<div class="small-text" style="opacity:0.75;">Ingen lagrede økter ennå.</div>`;
      return;
    }

    wrap.innerHTML = list.map(w => {
      const dateTxt = w.date ? `<span class="small-text" style="opacity:0.8;">${escapeHtml(w.date)}</span>` : '';
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:900;">${escapeHtml(w.title || 'Treningsøkt')}</div>
            ${dateTxt}
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(w.id)}"><i class="fas fa-upload"></i> Last</button>
            <button class="btn-small" type="button" data-wo-del="${escapeHtml(w.id)}"><i class="fas fa-trash"></i> Slett</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind actions
    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const s = loadWorkoutsStore().data;
        const w = s.workouts.find(x => x.id === id);
        if (w) applyWorkoutToState(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne økta?');
        if (!ok) return;
        const loaded2 = loadWorkoutsStore();
        const s2 = loaded2.data;
        s2.workouts = s2.workouts.filter(x => x.id !== id);
        saveWorkoutsStore(s2);
        renderWorkouts();
      });
    });
  }

  function saveWorkout() {
    const date = String($('woDate')?.value || '').trim();
    // For saved workouts, date is useful but not mandatory
    if (!date) {
      const ok = window.confirm('Ingen dato valgt. Vil du lagre økta likevel?');
      if (!ok) return;
    }

    const loaded = loadWorkoutsStore();
    const store = loaded.data;
    const w = serializeWorkoutFromState();

    // cap to avoid unbounded localStorage growth (user can still delete)
    const MAX = 100;
    store.workouts = store.workouts.filter(x => x.id !== w.id);
    store.workouts.unshift(w);
    if (store.workouts.length > MAX) store.workouts = store.workouts.slice(0, MAX);

    saveWorkoutsStore(store);
    renderWorkouts();
    if (typeof window.showNotification === 'function') window.showNotification('Økt lagret lokalt', 'success');
  }


  // -------------------------
  // Suggestions ("Lag en treningsøkt for meg")
  // -------------------------
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

  function suggestWorkout() {
    const idx = Math.floor(Math.random() * SUGGESTIONS.length);
    const tpl = SUGGESTIONS[idx];

    const blocks = [];
    for (const step of tpl) {
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

    renderBlocks();
    if (typeof window.showNotification === 'function') window.showNotification('Forslag generert – juster fritt', 'success');
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

    const blocksHtml = state.blocks.map((b, idx) => {
      const isPar = b.kind === 'parallel';
      const minutesA = clampInt(b.a?.minutes, 0, 300, 0);
      const minutesB = isPar ? clampInt(b.b?.minutes, 0, 300, 0) : 0;
      const blockMin = isPar ? Math.max(minutesA, minutesB) : minutesA;

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
        if (meta.coaching && meta.coaching.length) {
          info += '<div class="exp-coaching"><span class="exp-coaching-h">Tips:</span> ' + meta.coaching.map(c => escapeHtml(c)).join(' · ') + '</div>';
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
          <tr>
            <td class="exp-col-idx">${idx + 1}</td>
            <td class="exp-col-ex">
              <div class="exp-ex-name">${escapeHtml(exAName)}</div>
              ${infoA}
              ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
              ${groupsA}
            </td>
            <td class="exp-col-min">${blockMin}</td>
          </tr>
        `;
      }

      return `
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
        <div class="h-sub">${date ? `Dato: ${escapeHtml(date)} • ` : ''}Total tid: ${total} min</div>
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
            <th>Øvelse</th>
            <th style="text-align:right;">Min</th>
          </tr>
        </thead>
        <tbody>
          ${blocksHtml}
        </tbody>
      </table>
      ${attendanceHtml}
    </div>

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
    if (saveBtn) saveBtn.addEventListener('click', () => saveTemplate());
    if (saveWorkoutBtn) saveWorkoutBtn.addEventListener('click', () => saveWorkout());
    if (exportBtn) exportBtn.addEventListener('click', () => exportWorkout());

    if (dlJsonBtn) dlJsonBtn.addEventListener('click', () => downloadWorkoutFile());
    if (shareJsonBtn) shareJsonBtn.addEventListener('click', () => shareWorkoutFile());
    if (importJsonBtn) importJsonBtn.addEventListener('click', () => importWorkoutFileFromPicker());
    if (importFile) importFile.addEventListener('change', handleWorkoutFileInputChange);

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
        renderTemplates();
        renderWorkouts();
        restoreDraftIfAny();
        renderPlayersPanel();
        renderBlocks();

        // Last cloud-data for nytt lag
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

  // Last treningsdata fra cloud (Supabase user_data)
  async function loadWorkoutCloudData() {
    if (!window._bftCloud) return;
    try {
      var rows = await window._bftCloud.loadAll();
      if (rows === null) return; // Supabase feil → ikke gjør noe
      if (rows.length === 0) {
        // Cloud tom → bootstrap: push lokal data opp
        var tRaw = safeGet(STORE_KEY());
        if (tRaw && tRaw !== '{}' && tRaw !== '[]') window._bftCloud.save('workout_templates_v1', tRaw);
        var sRaw = safeGet(WORKOUTS_KEY());
        if (sRaw && sRaw !== '{}' && sRaw !== '[]') window._bftCloud.save('workout_sessions_v1', sRaw);
        var dRaw = safeGet(DRAFT_KEY());
        if (dRaw) window._bftCloud.save('workout_draft_v1', dRaw);
        return;
      }

      var updated = false;
      rows.forEach(function(row) {
        if (row.key === 'workout_templates_v1' && row.value) {
          var localRaw = safeGet(STORE_KEY());
          var cloudStr = JSON.stringify(row.value);
          if (!localRaw || localRaw === '{}' || localRaw === '[]') {
            safeSet(STORE_KEY(), cloudStr);
            updated = true;
          }
        }
        if (row.key === 'workout_sessions_v1' && row.value) {
          var localRaw = safeGet(WORKOUTS_KEY());
          var cloudStr = JSON.stringify(row.value);
          if (!localRaw || localRaw === '{}' || localRaw === '[]') {
            safeSet(WORKOUTS_KEY(), cloudStr);
            updated = true;
          }
        }
        if (row.key === 'workout_draft_v1' && row.value) {
          var localRaw = safeGet(DRAFT_KEY());
          if (!localRaw) {
            safeSet(DRAFT_KEY(), JSON.stringify(row.value));
            updated = true;
          }
        }
      });

      if (updated) {
        console.log('[workout.js] Cloud data lastet');
        renderTemplates();
        renderWorkouts();
        restoreDraftIfAny();
      }
    } catch (e) {
      console.warn('[workout.js] Cloud load feilet:', e.message);
    }
  }

  document.addEventListener('DOMContentLoaded', initIfPresent);

})();
