# SESONGFORDELING — Arkitektur v2

Sist oppdatert: 13. april 2026
Status: Designfase (ingen kode skrevet)
Erstatter: SESONGFORDELING-ARKITEKTUR-2026-04.md (v1)

---

## 1. PROBLEMET

Trenere i barnefotball fordeler spillere på lag og kamper manuelt, uten oversikt over total reisebelastning gjennom sesongen. Resultatet er ujevn fordeling av kilometer, hjemme/borte-kamper, draktfarge og antall kamper per spiller.

Validert med Sørlia/Egge J11: 22 spillere, 25 kampuker, 87 km spread mellom høyeste og laveste totalkjøring — med optimalisert fordeling.

---

## 2. FUNKSJONSOVERSIKT

Fem funksjoner som bygger på hverandre:

| # | Funksjon | Beskrivelse | Avhengigheter |
|---|----------|-------------|---------------|
| F1 | **Km-statistikk** | Vis reisebelastning per spiller over sesongen | Motstander-mapping, hjemmebane |
| F2 | **Fraværsvarsling** | Varsle trener når spiller ligger under snittet | event_players-data (finnes) |
| F3 | **Fordel jevnt** | Algoritmisk forslag til spillerfordeling | F1 + begrensninger |
| F4 | **Live teller** | Sanntidsoppdatering ved manuell justering + forfall | F1 + F3 |
| F5 | **Draktfarge-statistikk** | Vis fordeling av draktfarger per spiller | Draktfarge-config |

**F2 (fraværsvarsling) har ingen avhengighet til F1.** Den kan bygges uavhengig basert på eksisterende kampdata i event_players.

---

## 3. FORHOLDET TIL EKSISTERENDE KODE

### 3a. Eksisterende lagfordeling (IKKE dupliseres)

Appen har allerede et komplett lagfordelingssystem:

- `season_players.sub_team`: Hvilken lag-gruppe (1, 2, 3...) hver spiller tilhører
- `events.sub_team`: Hvilke kamper tilhører hvilket lag (fast modus)
- `event_players.sub_team`: Per-kamp-tilordning (rullerings-modus)
- `window.Grouping.makeEvenTeams()`: Snake-draft med keeper-korreksjon
- `renderRosterAssign()`: UI med "Jevne lag" (auto) og "Manuell"
- `runSnakeDraftUnassignedOnly()`: Håndterer nye spillere midt i sesong
- Counter chips og balance bar for visuell feedback

### 3b. Hva sesongfordelingen tilfører

Den nye funksjonen UTVIDER eksisterende sub_team-system med km-intelligens. Den erstatter ikke noe, men legger til:

1. **Km-data** (koordinater og avstand) på events
2. **Smartere algoritme** som bruker km/H/B/variasjon når den fordeler
3. **Profil-valg** for hva treneren prioriterer
4. **Live teller** som viser km-konsekvensen av endringer
5. **Draktfarge-beregning** og statistikk
6. **Trenerbarn-varsler** per lagkort
7. **Mid-sesong re-optimalisering** ved skader og endringer

Algoritmen bruker **eksakt samme output-format** som dagens system: `assignments[player_id] = sub_team_number`. Persistering skjer i de samme kolonnene som i dag.

---

## 4. SUPABASE-SKJEMAENDRINGER

### 4a. Eksisterende tabeller — nye kolonner

#### `seasons` — hjemmebane og fordelingskonfig

```sql
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_location      TEXT;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_lat            DOUBLE PRECISION;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_lon            DOUBLE PRECISION;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS distribution_config JSONB DEFAULT '{}';
```

**home_location**: Tekststreng, f.eks. "Guldbergaunet kunstgress". Settes av trener.

**home_lat / home_lon**: Koordinater for hjemmebane. Fylles automatisk via motstander-mapping eller manuelt.

**distribution_config JSONB-struktur:**
```json
{
  "profile": "balanced",
  "constraints": {
    "always_together": [
      ["p_001", "p_002"]
    ],
    "never_together": [
      ["p_005", "p_006"]
    ],
    "coach_child": {
      "coaches": {
        "Kim": ["p_emmie", "p_thelma"],
        "Tore": ["p_ella"],
        "Øyvind": ["p_elida"]
      },
      "min_coaches_per_game": 2,
      "min_children_per_game": 2
    }
  },
  "generated_at": "2026-04-13T10:00:00Z",
  "algorithm_version": 1
}
```

**profile**: `balanced` (default), `fair_driving`, `varied_teams`, `stable_teams`.

**coach_child**: Mapper trenernavn til array av spiller-IDer. Gjør det mulig å sjekke både antall trenerbarn OG antall unike trenere representert per lagkort.

#### `seasons.sub_team_names` — utvidet med draktfarge

Eksisterende JSONB-kolonne. Dagens format er en enkel array av strenger. Nytt format støtter begge:

```json
// Gammelt format (fortsatt gyldig):
["Sørlia/Egge", "Sørlia 2/Egge 2"]

// Nytt format med draktfarge:
[
  {
    "name": "Sørlia/Egge",
    "jersey_home": "rød",
    "jersey_away": "oransje"
  },
  {
    "name": "Sørlia 2/Egge 2",
    "jersey_home": "oransje",
    "jersey_away": "rød"
  }
]

// Lag som alltid har samme drakt:
[
  {
    "name": "Steinkjer G11",
    "jersey_home": "blå",
    "jersey_away": "blå"
  }
]
```

**Logikk**: Hvis `jersey_home === jersey_away` (eller bare én farge satt), brukes den alltid. Ellers velges basert på `events.is_home`.

**Bakoverkompatibilitet**: Client-side sjekker om array-elementet er en string (gammelt format) eller et objekt (nytt format). Ingen migrasjon nødvendig — gammelt format tolkes som "ingen draktfarge konfigurert".

#### `events` — bane-koordinater, avstand og draktfarge-overstyring

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lat  DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lon  DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS distance_km   REAL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS jersey        TEXT;
```

**location_lat / location_lon**: Cachet koordinat. Fylles fra motstander-mapping.

**distance_km**: Enveiskjøring fra hjemmebane. Beregnet med haversine. Kan korrigeres manuelt av trener. NULL for hjemmekamper. 0 for internkamper.

**jersey**: Per-kamp draktfarge-overstyring. NULL = bruk sesong-standard. Settes kun når treneren må overstyre (f.eks. draktkonflikt med motstander).

#### `season_players` — tilgjengelighet

```sql
ALTER TABLE season_players ADD COLUMN IF NOT EXISTS unavailable_until DATE;
```

**unavailable_until**: Spiller er utilgjengelig til og med denne datoen (skade, ferie etc.). NULL = tilgjengelig. Algoritmen ekskluderer spilleren fra kamper med `start_time <= unavailable_until`.

### 4b. Ingen nye tabeller, ingen nye kolonner på event_players

Alt løses med eksisterende `sub_team`, `in_squad`, `attended`, `absence_reason` på event_players. Ingen `dist_assigned`-kolonne trengs.

### 4c. SQL-migrasjon (komplett, idempotent)

```sql
-- Sesongfordeling: hjemmebane og fordelingskonfig
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_location      TEXT;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_lat            DOUBLE PRECISION;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS home_lon            DOUBLE PRECISION;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS distribution_config JSONB DEFAULT '{}';

-- Sesongfordeling: bane-koordinater, avstand og draktfarge per kamp
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lat  DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lon  DOUBLE PRECISION;
ALTER TABLE events ADD COLUMN IF NOT EXISTS distance_km   REAL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS jersey        TEXT;

-- Sesongfordeling: tilgjengelighet
ALTER TABLE season_players ADD COLUMN IF NOT EXISTS unavailable_until DATE;
```

**Verifikasjon etter kjøring:**
```sql
SELECT column_name, data_type, table_name
FROM information_schema.columns
WHERE table_name IN ('seasons', 'events', 'season_players')
  AND column_name IN (
    'home_location', 'home_lat', 'home_lon', 'distribution_config',
    'location_lat', 'location_lon', 'distance_km', 'jersey',
    'unavailable_until'
  )
ORDER BY table_name, column_name;
```

Forventet: 9 rader.

### 4d. RLS- og Realtime-konsekvenser

Ingen nye RLS-policies trengs. Alle nye kolonner arver eksisterende policies.

`events` og `season_players` har allerede Realtime Replication med REPLICA IDENTITY FULL. Nye kolonner inkluderes automatisk.

---

## 5. DATAFLYT

### 5a. Km-beregning: motstander-mapping (primær metode)

**Prinsipp**: I barnefotball spilles bortekamper nesten alltid i motstanderens hjemmekommune. I stedet for å parse banenavn, bruker vi motstandernavnet til å slå opp kommune-koordinater.

**Flyt:**
1. Fotball.no-import setter `events.opponent` = "Nessegutten" og `events.is_home` = false
2. Client-side: match "Nessegutten" → Namsos kommune
3. Oppslag i kommune-data: Namsos → lat 64.47, lon 11.50
4. Lagre i `events.location_lat`, `events.location_lon`
5. Beregn `events.distance_km` med haversine fra `seasons.home_lat/lon`

**Motstander-til-kommune-mapping:**
```javascript
// Bygges opp per sesong. Treneren ser mappingen og kan korrigere.
// Eksempel fra Sørlia/Egge J11:
{
  "Nessegutten": { kommune: "namsos", lat: 64.47, lon: 11.50 },
  "Snåsa":       { kommune: "snasa", lat: 64.23, lon: 11.83 },
  "Leksvik":     { kommune: "indre_fosen", lat: 63.67, lon: 10.62 },
  "Verdal":      { kommune: "verdal", lat: 63.79, lon: 11.48 },
  "Verdal 2":    { kommune: "verdal", lat: 63.79, lon: 11.48 },
  "Sverre":      { kommune: "levanger", lat: 63.75, lon: 11.30 },
  "Skogn/Ekne":  { kommune: "levanger", lat: 63.75, lon: 11.30 },
  "Steinkjer":   { kommune: "steinkjer", lat: 64.01, lon: 11.50 },
  "Inderøy":     { kommune: "inderoy", lat: 63.87, lon: 11.28 }
}
```

**Fordel vs. bane-parsing**: Motstandernavn er konsistent og enkelt å mappe. Bane-navnene "Kalkbanen", "Elberg", "Trøa" gir ingen klar kommune-match. Motstandernavn "Verdal", "Sverre", "Leksvik" gir direkte treff.

**Nøyaktighet**: ±10 km (kommune-sentroid). Godt nok for relativ sammenligning.

### 5b. Tre-trinns km-strategi

| Trinn | Metode | Dekning | Treneren gjør |
|-------|--------|---------|---------------|
| 1 | Hjemmekamp: km = 0 | 100% av hjemmekamper | Ingenting |
| 2 | Motstander → kommune → haversine | ~90% av bortekamper | Ser beregnet km, godkjenner |
| 3 | Manuell korrigering | Resterende ~10% | Endrer km-tallet direkte |

Trinn 3 er en enkel tallinnput per kamp i kamp-detalj-visningen. Ingen adresse-oppslag, ingen API-kostnader. Treneren ser "Verdal: 32 km" og justerer om nødvendig.

### 5c. Haversine-formel (client-side JS)

```javascript
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

Haversine gir luftlinje. Faktisk kjøreavstand er 1.2–1.4x lengre. For relativ sammenligning er dette irrelevant — alle spillere multipliseres med samme faktor.

### 5d. Draktfarge-beregning

```javascript
function getJersey(event, season, subTeamIndex) {
  // Per-kamp-overstyring har prioritet
  if (event.jersey) return event.jersey;

  // Hent sub_team config
  const config = season.sub_team_names?.[subTeamIndex - 1];
  if (!config) return null;

  // String format (gammelt) = ingen draktfarge
  if (typeof config === 'string') return null;

  // Samme drakt hjemme/borte
  if (config.jersey_home === config.jersey_away) return config.jersey_home;

  // Velg basert på H/B
  return event.is_home ? config.jersey_home : config.jersey_away;
}
```

### 5e. Internkamp-deteksjon

```javascript
function isInternalMatch(event, season) {
  if (!event.opponent) return false;
  const teamNames = (season.sub_team_names || []).map(
    t => typeof t === 'string' ? t : t.name
  );
  return teamNames.some(name =>
    event.opponent.includes(name) || name.includes(event.opponent)
  );
}
```

**Internkamp-regler:**
- distance_km = 0 for begge lag
- Ekskluderes fra automatisk fordeling (alle spillere er tilgjengelige)
- Teller som hjemmekamp for begge lag i H/B-statistikk
- Treneren kan fortsatt sette startoppstilling
- Lagsammensetning registreres og teller i variasjon-statistikken ("spilt med hvem")

---

## 6. ALGORITME

### 6a. Input

- Spillere: `season_players` med `active = true` og `unavailable_until` sjekket
- Kamper: `events` med `type = 'match'` (ekskl. internkamper)
- Km per kamp: `events.distance_km`
- H/B: `events.is_home`
- Draktfarge per kamp: beregnet fra sesong-config
- Begrensninger: `seasons.distribution_config.constraints`
- Antall underlag: `seasons.sub_team_count`
- Profil: `seasons.distribution_config.profile`

### 6b. Fire profiler

| Profil | km_spread | hb_spread | games_spread | variety | stability |
|--------|-----------|-----------|-------------|---------|-----------|
| **Balansert** (default) | 3 | 3 | 5* | 2 | 2 |
| **Rettferdig kjøring** | 5 | 3 | 5* | 1 | 0 |
| **Varierte lag** | 1 | 2 | 5* | 5 | 0 |
| **Faste lag** | 1 | 2 | 5* | 0 | 5 |

*`games_spread` er alltid høy fordi antall kamper per spiller alltid skal balanseres.

**Variasjon** måles ved å telle unike lagkamerater per spiller gjennom sesongen.
**Stabilitet** måles ved gjennomsnittlig overlapp mellom påfølgende lagsammensetninger.

### 6c. Metode

Hill-climbing med random restart. Kjøres i browser (vanilla JS).

1. Generer tilfeldig gyldig fordeling som respekterer begrensninger
2. Beregn vektet kostnadsfunksjon basert på valgt profil
3. Prøv tilfeldig swap (bytt to spillere mellom lag for én kamp)
4. Aksepter swap hvis kostnad synker
5. Gjenta 500–1000 iterasjoner
6. 20 restarts, returner beste løsning

**Ytelse**: Validert i Python: <1s for 22 spillere × 25 kamper. Ingen grunn til server-side.

### 6d. Kostnadsfunksjon

```javascript
function cost(assignments, events, profile) {
  const weights = PROFILES[profile];
  const stats = calcAllPlayerStats(assignments, events);

  const kmValues = stats.map(s => s.totalKm);
  const hbValues = stats.map(s => s.homeGames - s.awayGames);
  const gameValues = stats.map(s => s.totalGames);
  const varietyValues = stats.map(s => s.uniqueTeammates);

  return spread(kmValues)    * weights.km_spread
       + spread(hbValues)    * weights.hb_spread
       + spread(gameValues)  * weights.games_spread
       + invertedMean(varietyValues) * weights.variety;
       // + stability metric for 'stable_teams' profile
}
```

### 6e. Begrensninger (harde constraints)

Sjekkes ved generering og ved hver swap. Ugyldig swap avvises:

- **always_together**: Spillerne må være på samme lag i hver kamp
- **never_together**: Spillerne må aldri være på samme lag
- **coach_child**: Minimum N trenerbarn per lag per kamp, minimum M unike trenere representert
- **unavailable_until**: Spiller ekskluderes fra kamper før datoen

### 6f. Mid-sesong-håndtering

Når trener kjører "Fordel jevnt" midt i sesongen:

1. Allerede spillte kamper (attended != null) er låst
2. Akkumulert km/H/B/drakt fra spillte kamper brukes som startpunkt
3. Spillere med `unavailable_until` i fremtiden ekskluderes for relevante kamper
4. Algoritmen optimaliserer kun gjenværende kamper, kompenserer for ujevnheter

---

## 7. LIVE TELLER OG PERSISTERING

### 7a. Live teller — beregning

Ren client-side aritmetikk. Alle data er i minne når fordelingsvisningen er åpen.

```javascript
function playerStats(playerId, events, assignments) {
  let totalKm = 0, homeGames = 0, awayGames = 0;
  let jerseyCount = {}, teammates = new Set();

  for (const ev of events) {
    const playerTeam = assignments[playerId]?.[ev.id];
    if (!playerTeam) continue;
    if (isAbsent(playerId, ev.id)) continue;

    if (ev.is_home) homeGames++;
    else {
      awayGames++;
      totalKm += ev.distance_km || 0;
    }

    const jersey = getJersey(ev, season, playerTeam);
    if (jersey) jerseyCount[jersey] = (jerseyCount[jersey] || 0) + 1;

    // Track teammates for variety metric
    for (const [pid, team] of Object.entries(assignments)) {
      if (pid !== playerId && team[ev.id] === playerTeam) {
        teammates.add(pid);
      }
    }
  }

  return {
    totalKm, homeGames, awayGames,
    totalGames: homeGames + awayGames,
    jerseyCount,
    uniqueTeammates: teammates.size
  };
}
```

### 7b. Inline varsler per lagkort

Ved hver endring (flytt, forfall) sjekkes begrensninger for berørte kamper:

```javascript
function getAlerts(eventId, teamPlayers, constraints) {
  const alerts = [];

  // Trenerbarn-sjekk
  const cc = constraints.coach_child;
  if (cc) {
    const coachesRepresented = new Set();
    let childCount = 0;
    for (const [coach, children] of Object.entries(cc.coaches)) {
      const present = children.filter(id => teamPlayers.includes(id));
      if (present.length > 0) {
        coachesRepresented.add(coach);
        childCount += present.length;
      }
    }
    if (childCount < cc.min_children_per_game) {
      alerts.push({ type: 'error', text: `${childCount}/${cc.min_children_per_game} trenerbarn` });
    }
    if (coachesRepresented.size < cc.min_coaches_per_game) {
      alerts.push({ type: 'warning', text: `Kun ${coachesRepresented.size} trener(e)` });
    }
  }

  // Minimumstall
  const format = getSeasonFormat(); // 7, 9, 11 etc.
  if (teamPlayers.length < format) {
    alerts.push({ type: 'warning', text: `${teamPlayers.length} spillere – trenger minst ${format}` });
  }

  return alerts;
}
```

### 7c. Persistering — eksplisitt lagring

**Mønster**: Hold alt i minne under redigering. Eksplisitt "Lagre"-knapp committer til Supabase. Matcher etablert mønster fra treningsøkt-modulen ("Lagre og lukk").

**Hva lagres:**
- `season_players.sub_team` for permanent lag-tilordning
- `event_players.sub_team` for per-kamp-overstyring (rullerings-modus)
- `events.distance_km` for manuelt korrigerte km-verdier
- `events.jersey` for draktfarge-overstyring
- `seasons.distribution_config` for profil og begrensninger

**Batch-oppdatering** ved lagring: Samle alle endrede rader og kjør `.upsert()` per tabell. Typisk 20–50 rader totalt.

---

## 8. FILSTRUKTUR

### 8a. Nye filer

**`sesong-fordeling.js`** (~1000–1400 linjer estimat)
```
sesong-fordeling.js
├── Motstander-mapping og km-beregning (haversine, kommune-lookup)
├── Draktfarge-beregning (sesong-config + per-kamp-overstyring)
├── Internkamp-deteksjon
├── Algoritme (hill-climbing, kostnadsfunksjon, 4 profiler, begrensninger)
├── Live teller (stats-beregning, inline varsler)
├── UI-rendering (fordelingsvisning, lagkort, teller, begrensnings-editor)
└── Supabase CRUD (batch upsert ved eksplisitt lagring)
```

Eksponeres via `window.sesongFordeling`.

**`kommune-data.js`** (~15–20 KB komprimert)
```javascript
window.KOMMUNE_DATA = {
  "namsos":    { lat: 64.47, lon: 11.50 },
  "steinkjer": { lat: 64.01, lon: 11.50 },
  // ... alle ~356 kommuner
};
```

### 8b. Endringer i eksisterende filer

| Fil | Endring | Omfang |
|-----|---------|--------|
| season.js | "Fordel jevnt"-knapp, bridge-kall, `getSubTeamNames`-oppdatering for objekt-format | ~45 linjer |
| index.html | `<script>` for sesong-fordeling.js og kommune-data.js | 2 linjer |
| season.css | Styling for lagkort, teller, varsler, profil-velger | ~150 linjer |
| export-data.js | Bytt alle tabeller til `select('*')` — fikser både eksisterende hull og nye kolonner | ~6 linjer endret |

**season.js: `getSubTeamNames` må håndtere nytt objekt-format:**
```javascript
// Nåværende (linje 237, repo):
result.push(names[i] || ('Lag ' + String.fromCharCode(65 + i)));

// Oppdatert for bakoverkompatibilitet:
var entry = names[i];
var name = typeof entry === 'string' ? entry : (entry && entry.name) || null;
result.push(name || ('Lag ' + String.fromCharCode(65 + i)));
```

**season.js: `loadSeasons` bruker allerede `select('*')`.** Nye kolonner lastes automatisk uten kodeendring.

**export-data.js: Eksisterende GDPR-hull.** Filen mangler allerede mange deployde kolonner (sub_team, age_class, external_uid, parent_rsvp m.fl.). Enkleste fix er å bytte alle 6 SELECT-queries til `select('*')`:
- seasons (linje 154): `select('*')` i stedet for eksplisitt kolonneliste
- season_players (linje 167): `select('*')`
- events (linje 175): `select('*')`
- event_players (linje 188): `select('*')`
- match_events (linje 196): `select('*')`
- training_series (linje 206): `select('*')`

Dette fikser både eksisterende hull og fremtidsikrer mot nye kolonner.

**season.js vokser ikke signifikant** (nåværende: 7932 linjer i repo). Bridge-mønsteret er identisk med sesong-kampdag.js og sesong-workout.js.

---

## 9. UI-OVERSIKT

### 9a. Inngang: Sesong-dashboard

Ny knapp "Fordel spillere jevnt" synlig når:
- Sesongen har ≥2 kamper importert
- Sesongen har ≥1 aktiv spiller i stall
- Sesongen har sub_team_count ≥ 2

Knappen åpner fordelingsvisningen.

### 9b. Fordelingsvisning

**Topp: Profil-velger**
Fire piller: Balansert | Rettferdig kjøring | Varierte lag | Faste lag
Default: Balansert. Endring trigger re-beregning.

**Midt: Kampdag-navigasjon**
Datovelger-strip (identisk mønster som i prototypen). Viser én kampdag om gangen.

Per kampdag:
- To lagkort side om side (grid på desktop, stack på mobil)
- Hvert lagkort viser: lagnavn, motstander, H/B, draktfarge, inline varsler, spillerliste
- Spillerchips bruker `renderSeasonAvatar()` fra season.js for visuell konsistens med stall og kampdag
- Trykk på spiller → action sheet: "Meld fraværende" / "Flytt til [annet lag]"
- Fraværende spillere vises på benk med gjennomstreking
- Footer per kort: "11 aktive · 2 CC · 2 trener(e)"
- Internkamper: enkelt kort "Internkamp – alle møter. Sett startoppstilling her."

**Bunn: Statistikk-sammendrag**
Tabell per spiller: Navn | Kamper | Km (med visuell bar) | H | B | Drakt-fordeling
Visuell indikator for spread (grønn/gul/rød).

**Footer: Handlinger**
- "Fordel jevnt" (kjør/re-kjør algoritme)
- "Lagre" (persister til Supabase)

### 9c. Begrensnings-editor

Tilgjengelig via "Føringer"-knapp i fordelingsvisningen:
- Alltid sammen: Velg 2+ spillere
- Aldri sammen: Velg 2 spillere
- Trenerbarn: Velg trener → velg barn. Sett minimum per kamp.
- Profil-valg (kan også settes her)

### 9d. Draktfarge-innstillinger

I sesong-innstillinger (eksisterende view):
- Per sub_team: Sett draktfarge hjemme / draktfarge borte
- Toggle "Alltid samme drakt" → setter begge likt

I kamp-detalj:
- Dropdown for å overstyre draktfarge for denne kampen

### 9e. Km-korrigering

I kamp-detalj-visningen:
- Viser beregnet km med kilde: "32 km (basert på motstander: Verdal)"
- Tallinnput for manuell overstyring
- "Nullstill" for å gå tilbake til beregnet verdi

---

## 10. SESONG-STATISTIKK

Integreres i eksisterende statistikk-dashboard i sesong-visningen.

**Beregning (on-the-fly fra event_players + events):**

Per spiller:
- `planned_km`: sum(distance_km) der sub_team er satt og absence_reason IS NULL
- `actual_km`: sum(distance_km) der attended = true
- `home_games` / `away_games`: basert på is_home
- `jersey_breakdown`: antall kamper per draktfarge
- `unique_teammates`: antall unike lagkamerater gjennom sesongen
- `absent_games`: antall kamper med absence_reason

**Ingen egen statistikk-tabell.** Alt utledes on-the-fly, identisk mønster som eksisterende spilletids-statistikk.

---

## 11. FRAVÆRSVARSLING (F2 — uavhengig)

Bygges uavhengig av km-statistikk.

**Logikk:**
1. Tell kamper per spiller (attended=true ELLER sub_team satt for fremtidige kamper)
2. Beregn gjennomsnitt
3. Hvis spiller ≥2 kamper under snittet → varsle

**Terskel:** Fast (2 kamper). Konfigurerbar senere.

**Visning:** Badge i sesong-dashboard + i kampdetalj.

**Kun trener-synlig.** Ikke på lagside.

---

## 12. IMPLEMENTERINGSREKKEFØLGE

| Steg | Hva | Estimat | Avhengigheter |
|------|-----|---------|---------------|
| 1 | SQL-migrasjon (9 ALTER TABLE) | 30 min | Ingen |
| 2 | kommune-data.js (statisk JSON) | 2 timer | Ingen |
| 3 | Hjemmebane-setting i sesong-innstillinger | 2 timer | Steg 1 |
| 4 | Motstander-mapping + km-beregning | 4 timer | Steg 1, 2 |
| 5 | Draktfarge-config i sesong-innstillinger | 2 timer | Steg 1 |
| 6 | Km-statistikk visning (read-only) | 3 timer | Steg 4 |
| 7 | Fraværsvarsling (uavhengig) | 3 timer | Steg 1 |
| 8 | Begrensnings-editor (trenerbarn, alltid/aldri sammen) | 4 timer | Steg 1 |
| 9 | "Fordel jevnt"-algoritme (4 profiler) | 6 timer | Steg 4, 8 |
| 10 | Fordelingsvisning med lagkort og live teller (bruk `renderSeasonAvatar`) | 8 timer | Steg 9 |
| 11 | Forfall + flytt spiller (action sheet) | 3 timer | Steg 10 |
| 12 | Internkamp-håndtering | 2 timer | Steg 10 |
| 13 | Draktfarge-statistikk og per-kamp-overstyring | 2 timer | Steg 5, 10 |
| 14 | GDPR-eksport: bytt 6 queries til `select('*')` i export-data.js | 30 min | Steg 1 |

**Total estimat: ~41 timer arbeid.**

Steg 7 (fraværsvarsling) kan gjøres parallelt med steg 3–6.
Steg 5 (draktfarge) kan gjøres parallelt med steg 3–4.
Steg 14 (GDPR) kan gjøres når som helst etter steg 1.

---

## 13. ÅPNE SPØRSMÅL

| # | Spørsmål | Anbefaling |
|---|----------|------------|
| 1 | Motstander-mapping: dekker den 90%+ av bortebaner? | Prototyp med Sørlia/Egge-data for å verifisere |
| 2 | Draktfarge: trengs predefinert fargepalett eller fritekst? | Start med fritekst, vurder dropdown senere |
| 3 | Lagside: vise km-statistikk til foreldre? | Ikke MVP. GDPR-vurdering nødvendig |
| 4 | Sverige (3-periode): påvirker fordelings-algoritmen? | Nei, algoritmen fordeler på kamper, ikke perioder |
| 5 | Kampuker med kun ett lag: kompenserer algoritmen? | Ja, implisitt via games_spread i kostnadsfunksjonen |
| 6 | Forfall for fremtidig kamp: skal det automatisk foreslå erstatning? | Mulig utvidelse, ikke MVP |

---

## 14. REFERANSEFILER

| Fil | Rolle |
|-----|-------|
| trener_v3_(6).html | Prototype fra annen chat — UI-referanse for lagkort, action sheet, statistikk |
| season.js (7932 linjer, repo apr 2026) | Eksisterende lagfordeling, `getSubTeamNames`, `renderSeasonAvatar`, sub_team-logikk |
| sesong-kampdag.js | IIFE + bridge-mønster referanse |
| sesong-workout.js | IIFE + bridge-mønster referanse |
| grouping.js | Snake-draft og keeper-korreksjon |
| export-data.js | GDPR-eksport — trenger `select('*')` fix (eksisterende hull + nye kolonner) |
| SUPABASE-SCHEMA-2026-03-15.md | Nåværende skjema (verifiser mot prod) |
| DESIGN-REFRESH-B.md | Stilguide (#456C4B, border-radius, font-weight 500, Outfit) |
| nextchat.docx | Kontekstdokument fra annen chat med produktspec og åpne spørsmål |

---

*Holmvik Utvikling ENK · Steinkjer · April 2026*
