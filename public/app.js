const state = {
  people: [],
  peopleById: new Map(),
  person: null,
  tab: "bio",
  home: {
    category: "all",
    term: "",
    revelation: "all",
    riwayah: "all",
    country: "all",
    sort: "alphabetical",
    content: "all",
    surah: "all",
  },
  homeFilters: {
    countries: [],
    riwayat: [],
    revelations: [],
    surahs: [],
  },
  homeTracks: [],
  homeMatchedTracks: [],
  homeVisibleTracks: [],
  selectedPeople: new Set(),
  sideHomeButtonVisible: false,
  resolvedPlayers: new Map(),
  syncedRecitations: new Map(),
  syncedRecordings: new Map(),
  recitationControls: {
    sort: "traditional",
    revelation: "all",
    collection: "all",
    shuffle: false,
    repeat: "off",
  },
  queue: [],
  currentRecitationId: null,
  recordingPlayer: {
    audio: null,
    queue: [],
    index: -1,
    shuffle: false,
    repeat: 0,
    repeatLeft: 0,
    autoplay: localStorage.getItem("assabile-player-autoplay") !== "false",
    collapsed: false,
    playlistCollapsed: false,
    volume: Number.parseFloat(localStorage.getItem("assabile-player-volume") || "1"),
    speed: Number.parseFloat(localStorage.getItem("assabile-player-speed") || "1"),
    savedSize: null,
    fullsizeSavedSize: null,
    videoFullsize: false,
    cache: new Map(),
    trimStart: 0,
    trimEnd: 0,
    trimEnding: false,
    queueLocked: false,
  },
};

const SEARCH_MEMORY_KEY = "assabile-local-search-memory";

const $ = (selector) => document.querySelector(selector);

if (!Number.isFinite(state.recordingPlayer.volume)) {
  state.recordingPlayer.volume = 1;
}
if (!Number.isFinite(state.recordingPlayer.speed)) {
  state.recordingPlayer.speed = 1;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatRole(role) {
  return role.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function countLabel(key) {
  const labels = {
    collections: "Al-Massahef",
    recitations: "Recitations",
    anasheed: "Anasheed",
    audioLessons: "Audio lessons",
    videoLessons: "Video lessons",
    photos: "Photos",
  };
  return labels[key] || key;
}

function readSearchMemory() {
  try {
    const values = JSON.parse(localStorage.getItem(SEARCH_MEMORY_KEY) || "[]");
    return Array.isArray(values) ? values.filter(Boolean).slice(0, 30) : [];
  } catch {
    return [];
  }
}

function rememberSearchTerm(term) {
  const value = String(term || "").trim();
  if (value.length < 2) return;
  const normalized = value.toLowerCase();
  const next = [value, ...readSearchMemory().filter((item) => item.toLowerCase() !== normalized)].slice(0, 30);
  localStorage.setItem(SEARCH_MEMORY_KEY, JSON.stringify(next));
}

function queryTerms(term) {
  return String(term || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function allTermsMatch(haystack, terms) {
  const text = String(haystack || "").toLowerCase();
  return terms.every((term) => text.includes(term));
}

function profileShortId(person) {
  return String(person?.id || "").split("-").pop() || "";
}

function personSearchHaystack(person) {
  return [
    person.id,
    profileShortId(person),
    person.name,
    person.arabicName,
    person.country,
    ...(person.roles || []),
    ...(person.riwayat || []),
    ...(person.revelations || []),
    ...(person.surahs || []),
  ].join(" ");
}

function trackSearchHaystack(track) {
  return [track.title, track.subtitle, track.personId, track.personName, track.riwayah, track.revelation, track.kind].join(" ");
}

function personMatchesHomeTerms(person, terms) {
  if (!terms.length) return true;
  const identity = personSearchHaystack(person);
  if (allTermsMatch(identity, terms)) return true;
  return state.homeTracks.some((track) => {
    if (track.personId !== person.id) return false;
    return allTermsMatch(`${identity} ${trackSearchHaystack(track)}`, terms);
  });
}

function snippet(value, limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function numeric(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recitationTitle(recitation) {
  const number = recitation.number ? `#${recitation.number} ` : "";
  return `${number}${recitation.surah || "Untitled"}`;
}

function normalizeRiwayah(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’`´ʻʿ]/g, "'")
    .replace(/'+/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const RIWAYAH_ALIASES = new Map(
  [
    ["Khalaf A''n Hamzah", "Khalaf A'n Hamzah"],
    ["Khelaf A'n Hemzah", "Khalaf A'n Hamzah"],
    ["\u0623\u0628\u064a \u0627\u0644\u062d\u0627\u0631\u062b \u0639\u0646 \u0627\u0644\u0643\u0633\u0627\u0626\u064a", "Aby Harytha A'n Al-Ksa'iy"],
    ["\u0627\u0644\u0628\u0632\u064a \u0648\u0642\u0646\u0628\u0644 \u0639\u0646 \u0627\u0628\u0646 \u0643\u062b\u064a\u0631", "Albizi and Qunbol A'n Ibn Katheer"],
    ["\u0627\u0644\u062f\u0648\u0631\u064a \u0639\u0646 \u0623\u0628\u064a \u0639\u0645\u0631\u0648", "Ad-Dwry A'n Abi Amr"],
    ["\u0627\u0644\u062f\u0648\u0631\u064a \u0639\u0646 \u0627\u0644\u0643\u0633\u0627\u0626\u064a", "Ad-Dwry An Al-Ksa'iy"],
    ["\u0627\u0644\u0633\u0648\u0633\u064a \u0639\u0646 \u0623\u0628\u064a \u0639\u0645\u0631\u0648", "Assosi A'n Abi Amr"],
    ["\u062d\u0641\u0635 \u0639\u0646 \u0639\u0627\u0635\u0645", "Hafs A'n Assem"],
    ["\u0634\u0639\u0628\u0629 \u0639\u0646 \u0639\u0627\u0635\u0645", "Sh'bt A'n Assem"],
    ["\u0642\u0627\u0644\u0648\u0646 \u0639\u0646 \u0646\u0627\u0641\u0639", "Qalon A'n Nafi'"],
    ["\u0648\u0631\u0634 \u0639\u0646 \u0646\u0627\u0641\u0639", "Warsh A'n Nafi'"],
  ].map(([alias, canonical]) => [normalizeRiwayah(alias), canonical])
);

function canonicalRiwayah(value) {
  return RIWAYAH_ALIASES.get(normalizeRiwayah(value)) || String(value || "").trim();
}

function uniqueCanonicalRiwayat(values) {
  return [...new Set((values || []).map(canonicalRiwayah).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matchesRiwayah(value, selected = state.home.riwayah) {
  if (selected === "all") return true;
  return normalizeRiwayah(canonicalRiwayah(value)) === normalizeRiwayah(canonicalRiwayah(selected));
}

function homeUsesQuranFilters(category = state.home.category) {
  return category === "all" || category === "quran";
}

function personCount(person, key) {
  if (!person) return 0;
  if (key === "collections") return person.collections?.length ?? numeric(person.tabs?.collections, 0);
  if (key === "recitations") return person.recitations?.length ?? numeric(person.tabs?.recitations, 0);
  if (key === "anasheed") return person.albums?.length ?? numeric(person.tabs?.anasheed, 0);
  if (key === "audioLessons") return person.audioLessons?.length ?? numeric(person.tabs?.audioLessons, 0);
  if (key === "videoLessons") return person.videoLessons?.length ?? numeric(person.tabs?.videoLessons, 0);
  if (key === "photos") return person.photos?.length ?? numeric(person.tabs?.photos, 0);
  if (key === "videos") return person.videos?.length ?? numeric(person.tabs?.videos, 0);
  if (key === "lessons") return personCount(person, "audioLessons") + personCount(person, "videoLessons");
  return numeric(person.tabs?.[key], 0);
}

function categoryPeople(category = state.home.category, term = state.home.term) {
  const terms = queryTerms(term);
  const applyQuranFilters = homeUsesQuranFilters(category);
  const contentFilter = state.home.content;
  const people = state.people.filter((person) => {
    const tabs = person.tabs || {};
    const roles = person.roles || [];
    const riwayat = uniqueCanonicalRiwayat(person.riwayat || []);
    const revelations = person.revelations || [];
    const surahs = person.surahs || [];
    const categoryOk =
      category === "all" ||
      (category === "quran" && (roles.includes("reciter") || tabs.recitations || tabs.collections)) ||
      (category === "anasheed" && (roles.includes("munshid") || tabs.anasheed || tabs.albums)) ||
      (category === "lessons" && (tabs.audioLessons || tabs.videoLessons || roles.includes("preacher"))) ||
      (category === "photos" && tabs.photos) ||
      (category === "videos" && tabs.videos);
    if (!categoryOk) return false;
    if (contentFilter !== "all" && personCount(person, contentFilter) <= 0) return false;
    if (state.home.country !== "all" && person.country !== state.home.country) return false;
    if (applyQuranFilters && state.home.revelation !== "all" && !revelations.some((revelation) => revelation.toLowerCase() === state.home.revelation)) return false;
    if (applyQuranFilters && state.home.riwayah !== "all" && !riwayat.some((riwayah) => matchesRiwayah(riwayah))) return false;
    if (applyQuranFilters && state.home.surah !== "all" && !surahs.includes(state.home.surah)) return false;
    return personMatchesHomeTerms(person, terms);
  });
  return sortHomePeople(people);
}

function sortHomePeople(people) {
  const sorted = [...people];
  const sort = state.home.sort;
  sorted.sort((a, b) => {
    if (sort === "recitations") return personCount(b, "recitations") - personCount(a, "recitations") || a.name.localeCompare(b.name);
    if (sort === "anasheed") return personCount(b, "anasheed") - personCount(a, "anasheed") || a.name.localeCompare(b.name);
    if (sort === "audioLessons") return personCount(b, "audioLessons") - personCount(a, "audioLessons") || a.name.localeCompare(b.name);
    if (sort === "videoLessons") return personCount(b, "videoLessons") - personCount(a, "videoLessons") || a.name.localeCompare(b.name);
    if (sort === "photos") return personCount(b, "photos") - personCount(a, "photos") || a.name.localeCompare(b.name);
    if (sort === "videos") return personCount(b, "videos") - personCount(a, "videos") || a.name.localeCompare(b.name);
    if (sort === "lessons") return personCount(b, "lessons") - personCount(a, "lessons") || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  return sorted;
}

function renderHome() {
  const hadSearchFocus = document.activeElement?.id === "home-search";
  const caret = hadSearchFocus ? $("#home-search")?.selectionStart ?? state.home.term.length : state.home.term.length;
  state.person = null;
  state.tab = "bio";
  renderSideHome();
  $("#profile").innerHTML = `
    <div>
      <h1>Assabile Local</h1>
      <p class="muted">Browse the local catalogue by section, then cache only the media you choose to play.</p>
    </div>
  `;
  $("#tabs").innerHTML = "";
  const categories = homeCategories();
  const people = categoryPeople();
  const countries = state.homeFilters.countries || [];
  const riwayat = uniqueCanonicalRiwayat(state.homeFilters.riwayat || []);
  const surahs = state.homeFilters.surahs || [];
  const searchMemory = readSearchMemory().filter((item) => item.toLowerCase().includes(state.home.term.trim().toLowerCase())).slice(0, 8);
  const trackTerms = queryTerms(state.home.term);
  const quranFiltersVisible = homeUsesQuranFilters();
  const showTrackMatches = Boolean(trackTerms.length || (quranFiltersVisible && (state.home.riwayah !== "all" || state.home.revelation !== "all" || state.home.surah !== "all")));
  const tracks = showTrackMatches
    ? state.homeTracks.filter((track) => {
        if (state.home.category !== "all" && state.home.category !== "quran" && track.kind === "recitation") return false;
        if (state.home.category !== "all" && state.home.category !== "anasheed" && track.kind === "anasheed") return false;
        if (state.home.category !== "all" && state.home.category !== "lessons" && track.kind === "audioLesson") return false;
        if (state.home.country !== "all") {
          const person = state.peopleById.get(track.personId);
          if (person?.country !== state.home.country) return false;
        }
        if (quranFiltersVisible && state.home.revelation !== "all" && (track.revelation || "").toLowerCase() !== state.home.revelation) return false;
        if (quranFiltersVisible && state.home.riwayah !== "all" && !matchesRiwayah(track.riwayah)) return false;
        if (quranFiltersVisible && state.home.surah !== "all" && track.title !== state.home.surah) return false;
        if (!trackTerms.length) return true;
        return allTermsMatch(trackSearchHaystack(track), trackTerms);
      })
    : [];
  const renderedTracks = tracks.slice(0, 240);
  state.homeMatchedTracks = tracks;
  state.homeVisibleTracks = renderedTracks;
  $("#panel").innerHTML = `
    <div class="home-panel">
      <div class="home-toolbar">
        <div class="home-categories">
          ${categories
            .map(
              (category) => `
                <button class="tab ${state.home.category === category.id ? "active" : ""}" data-home-category="${category.id}">
                  ${category.label} <span>${category.count}</span>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="home-filters">
          <div class="search-box">
            <input id="home-search" type="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="search" name="assabile-local-${Date.now()}" placeholder="Keyword search">
            ${
              searchMemory.length
                ? `<div class="search-memory" id="home-search-memory">
                    ${searchMemory.map((term) => `<button type="button" data-search-memory="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}
                  </div>`
                : ""
            }
          </div>
          ${
            quranFiltersVisible
              ? `<select id="home-revelation">
            <option value="all" ${state.home.revelation === "all" ? "selected" : ""}>All revelation</option>
            <option value="makiya" ${state.home.revelation === "makiya" ? "selected" : ""}>Makiya</option>
            <option value="madaniya" ${state.home.revelation === "madaniya" ? "selected" : ""}>Madaniya</option>
          </select>
          <select id="home-riwayah">
            <option value="all" ${state.home.riwayah === "all" ? "selected" : ""}>All riwayat</option>
            ${riwayat.map((riwayah) => `<option value="${escapeHtml(riwayah)}" ${state.home.riwayah === riwayah ? "selected" : ""}>${escapeHtml(riwayah)}</option>`).join("")}
          </select>`
              : ""
          }
          <select id="home-country">
            <option value="all" ${state.home.country === "all" ? "selected" : ""}>All countries</option>
            ${countries.map((country) => `<option value="${escapeHtml(country)}" ${state.home.country === country ? "selected" : ""}>${escapeHtml(country)}</option>`).join("")}
          </select>
          ${
            quranFiltersVisible
              ? `<select id="home-surah">
                  <option value="all" ${state.home.surah === "all" ? "selected" : ""}>All surahs</option>
                  ${surahs.map((surah) => `<option value="${escapeHtml(surah)}" ${state.home.surah === surah ? "selected" : ""}>${escapeHtml(surah)}</option>`).join("")}
                </select>`
              : ""
          }
          <select id="home-content">
            <option value="all" ${state.home.content === "all" ? "selected" : ""}>All content</option>
            <option value="recitations" ${state.home.content === "recitations" ? "selected" : ""}>Has recitations</option>
            <option value="anasheed" ${state.home.content === "anasheed" ? "selected" : ""}>Has anasheed</option>
            <option value="audioLessons" ${state.home.content === "audioLessons" ? "selected" : ""}>Has audio lessons</option>
            <option value="videoLessons" ${state.home.content === "videoLessons" ? "selected" : ""}>Has video lessons</option>
            <option value="photos" ${state.home.content === "photos" ? "selected" : ""}>Has photos</option>
            <option value="videos" ${state.home.content === "videos" ? "selected" : ""}>Has videos</option>
          </select>
          <select id="home-sort">
            <option value="alphabetical" ${state.home.sort === "alphabetical" ? "selected" : ""}>Alphabetical</option>
            <option value="recitations" ${state.home.sort === "recitations" ? "selected" : ""}>Most recitations</option>
            <option value="anasheed" ${state.home.sort === "anasheed" ? "selected" : ""}>Most anasheed</option>
            <option value="audioLessons" ${state.home.sort === "audioLessons" ? "selected" : ""}>Most audio lessons</option>
            <option value="videoLessons" ${state.home.sort === "videoLessons" ? "selected" : ""}>Most video lessons</option>
            <option value="lessons" ${state.home.sort === "lessons" ? "selected" : ""}>Most lessons</option>
            <option value="photos" ${state.home.sort === "photos" ? "selected" : ""}>Most photos</option>
            <option value="videos" ${state.home.sort === "videos" ? "selected" : ""}>Most videos</option>
          </select>
        </div>
      </div>
      <div class="bulk-toolbar">
        <span>${state.selectedPeople.size} selected</span>
        <select id="bulk-kind">
          <option value="all">All media</option>
          <option value="recitations">Recitations only</option>
          <option value="anasheed">Anasheed only</option>
          <option value="audioLessons">Audio lessons only</option>
          <option value="videoLessons">Video lessons only</option>
          <option value="photos">Photos only</option>
          <option value="videos">Videos only</option>
        </select>
        <button class="button secondary" type="button" data-select-visible>Toggle visible</button>
        <button class="button" type="button" data-bulk-selected ${state.selectedPeople.size ? "" : "disabled"}>Download selected ZIP</button>
      </div>
      <div class="grid">
        ${
          people
            .map((person) => {
              const roles = (person.roles || []).map((role) => `<span class="chip">${formatRole(role)}</span>`).join("");
              return `
                <div class="item home-person" data-home-person-card="${person.id}">
                  ${person.banner ? `<img class="home-person-banner" src="${escapeHtml(person.banner)}" loading="lazy" alt="">` : ""}
                  <div class="item-tools">
                    <label class="select-person" title="Select for bulk download">
                      <input type="checkbox" data-select-person="${person.id}" ${state.selectedPeople.has(person.id) ? "checked" : ""}>
                    </label>
                    <button class="tool-button" data-home-person-download="${person.id}" title="Download profile image" ${person.image ? "" : "disabled"}>&#8681;</button>
                    ${person.profileUrl ? `<a class="tool-button" href="${escapeHtml(person.profileUrl)}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>` : ""}
                    <button class="tool-button" data-home-person-go="${person.id}" title="Go to profile">&#10140;</button>
                  </div>
                  <div class="home-person-head">
                    ${
                      person.image
                        ? `<img class="avatar profile-image" src="${escapeHtml(person.image)}" loading="lazy" alt="">`
                        : `<span class="avatar avatar-initial">${(person.name || "?").trim().slice(0, 1).toUpperCase()}</span>`
                    }
                    <div>
                      <h3>${person.name}</h3>
                      <p class="muted">${person.country || ""}</p>
                    </div>
                  </div>
                  ${person.bio ? `<p class="home-person-bio">${escapeHtml(snippet(person.bio))}</p>` : ""}
                  <div class="chips">${roles}</div>
                  <div class="content-counts">${renderPersonContentCounts(person)}</div>
                </div>
              `;
            })
            .join("") || `<div class="empty"><h2>No matches</h2><p>Try another category or keyword.</p></div>`
        }
      </div>
      ${
        showTrackMatches
          ? `<div class="toolbar"><h2>Tracks</h2><span class="muted">${tracks.length} matches${tracks.length > renderedTracks.length ? `, showing ${renderedTracks.length}` : ""}</span></div>
             <div class="grid">
              ${
                renderedTracks
                  .map(
                    (track, index) => `
                      <div class="item home-track ${isCurrentHomeTrack(track) ? "active-item" : ""}" data-home-track-index="${index}" data-track-key="${escapeHtml(queueKey(homeTrackQueueItem(track)))}">
                        <div class="item-tools">
                          <button class="tool-button" data-home-track-play="${index}" title="Play">&#9654;</button>
                          <button class="tool-button" data-home-track-add="${index}" title="Add to queue">+</button>
                          <button class="tool-button" data-home-track-download="${index}" title="Download">&#8681;</button>
                          ${track.detailUrl || track.sourceUrl ? `<a class="tool-button" href="${escapeHtml(track.detailUrl || track.sourceUrl)}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>` : ""}
                          <button class="tool-button" data-home-track-go="${index}" title="Go to profile">&#10140;</button>
                        </div>
                        <h3>${escapeHtml(track.title || "Untitled")}</h3>
                        <p class="muted">${escapeHtml(track.personName || "")}</p>
                        <p>${escapeHtml(track.subtitle || track.kind)}</p>
                      </div>
                    `
                  )
                  .join("") || `<div class="empty"><h2>No track matches</h2><p>Try another keyword or filter.</p></div>`
              }
             </div>`
          : ""
      }
    </div>
  `;
  const search = $("#home-search");
  search.value = state.home.term;
  search.addEventListener("input", (event) => {
    state.home.term = event.target.value;
    renderHome();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") rememberSearchTerm(event.currentTarget.value);
  });
  search.addEventListener("blur", (event) => rememberSearchTerm(event.currentTarget.value));
  if (hadSearchFocus) {
    const refreshedSearch = $("#home-search");
    refreshedSearch.focus({ preventScroll: true });
    refreshedSearch.setSelectionRange(caret, caret);
  }
  ["revelation", "riwayah", "country", "surah"].forEach((key) => {
    const control = $(`#home-${key}`);
    if (!control) return;
    control.addEventListener("change", (event) => {
      state.home[key] = event.target.value;
      renderHome();
    });
  });
  ["sort", "content"].forEach((key) => {
    const control = $(`#home-${key}`);
    if (!control) return;
    control.addEventListener("change", (event) => {
      state.home[key] = event.target.value;
      renderHome();
    });
  });
  document.querySelectorAll("[data-search-memory]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      state.home.term = button.dataset.searchMemory || "";
      rememberSearchTerm(state.home.term);
      renderHome();
    });
  });
  document.querySelectorAll("[data-home-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.home.category = button.dataset.homeCategory;
      if (!homeUsesQuranFilters(state.home.category)) {
        state.home.revelation = "all";
        state.home.riwayah = "all";
        state.home.surah = "all";
      }
      renderHome();
    });
  });
  document.querySelectorAll("[data-home-person-download]").forEach((button) => {
    button.addEventListener("click", () => downloadHomePersonImage(button, button.dataset.homePersonDownload));
  });
  document.querySelectorAll("[data-select-person]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedPeople.add(checkbox.dataset.selectPerson);
      else state.selectedPeople.delete(checkbox.dataset.selectPerson);
      renderHome();
    });
  });
  $("[data-select-visible]")?.addEventListener("click", () => {
    const visibleIds = people.map((person) => person.id);
    const allSelected = visibleIds.every((id) => state.selectedPeople.has(id));
    visibleIds.forEach((id) => {
      if (allSelected) state.selectedPeople.delete(id);
      else state.selectedPeople.add(id);
    });
    renderHome();
  });
  $("[data-bulk-selected]")?.addEventListener("click", () => bulkDownloadSelected());
  document.querySelectorAll("[data-home-person-go]").forEach((button) => {
    button.addEventListener("click", () => selectPerson(button.dataset.homePersonGo));
  });
  document.querySelectorAll("[data-home-track-play]").forEach((button) => {
    button.addEventListener("click", () => playHomeTrack(Number(button.dataset.homeTrackPlay)));
  });
  document.querySelectorAll("[data-home-track-add]").forEach((button) => {
    button.addEventListener("click", () => addHomeTrack(button, Number(button.dataset.homeTrackAdd)));
  });
  document.querySelectorAll("[data-home-track-download]").forEach((button) => {
    button.addEventListener("click", () => downloadHomeTrack(button, Number(button.dataset.homeTrackDownload)));
  });
  document.querySelectorAll("[data-home-track-go]").forEach((button) => {
    button.addEventListener("click", () => goToHomeTrack(Number(button.dataset.homeTrackGo)));
  });
}

function homeCategories() {
  return [
    { id: "all", label: "All", count: categoryPeople("all", "").length },
    { id: "quran", label: "Quran", count: categoryPeople("quran", "").length },
    { id: "anasheed", label: "Anasheed", count: categoryPeople("anasheed", "").length },
    { id: "lessons", label: "Lessons", count: categoryPeople("lessons", "").length },
    { id: "photos", label: "Photos", count: categoryPeople("photos", "").length },
    { id: "videos", label: "Videos", count: categoryPeople("videos", "").length },
  ];
}

function renderDocsHome(categories) {
  state.person = null;
  renderSideHome();
  $("#profile").innerHTML = `
    <div>
      <h1>Assabile Local</h1>
      <p class="muted">Local controls and command reference.</p>
    </div>
  `;
  $("#tabs").innerHTML = "";
  $("#panel").innerHTML = `
    <div class="home-panel">
      <div class="home-toolbar">
        <div class="home-categories">
          ${categories
            .map(
              (category) => `
                <button class="tab ${state.home.category === category.id ? "active" : ""}" data-home-category="${category.id}">
                  ${category.label}${category.count !== "" ? ` <span>${category.count}</span>` : ""}
                </button>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="docs-panel" id="docs-panel"><p class="muted">Loading docs...</p></div>
    </div>
  `;
  document.querySelectorAll("[data-home-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.home.category = button.dataset.homeCategory;
      renderHome();
    });
  });
  loadDocsPanel();
}

async function loadDocsPanel() {
  const panel = $("#docs-panel");
  if (!panel) return;
  try {
    const docs = await api("/api/docs");
    panel.innerHTML = `<h2>${escapeHtml(docs.title || "Docs")}</h2><pre class="docs-body">${escapeHtml(docs.body || "")}</pre>`;
  } catch (error) {
    panel.innerHTML = `<div class="empty"><h2>Could not load docs</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderSideHome() {
  const side = $("#side-home");
  if (!side) return;
  const hadFocus = document.activeElement?.id === "side-home-search";
  const caret = hadFocus ? $("#side-home-search")?.selectionStart ?? state.home.term.length : state.home.term.length;
  if (!state.person) {
    side.innerHTML = "";
    side.classList.remove("visible");
    side.closest(".app-shell")?.classList.remove("has-sidebar");
    return;
  }
  const matches = categoryPeople("all", state.home.term).slice(0, 18);
  state.sideHomeButtonVisible = shouldShowSideHomeButton();
  side.classList.add("visible");
  side.closest(".app-shell")?.classList.add("has-sidebar");
  side.innerHTML = `
    <div class="side-home-header">
      <strong>Search</strong>
      ${state.sideHomeButtonVisible ? `<button class="icon-button" type="button" data-side-home-button title="Home">&#8962;</button>` : ""}
    </div>
    <input id="side-home-search" type="text" autocomplete="off" spellcheck="false" placeholder="Find profile" value="${escapeHtml(state.home.term)}">
    <div class="side-home-list">
      ${matches
        .map(
          (person) => `
            <button type="button" data-side-person="${person.id}" class="${state.person?.id === person.id ? "active" : ""}">
              <span>${escapeHtml(person.name)}</span>
              <small>${escapeHtml(person.country || "")}</small>
            </button>
          `
        )
        .join("")}
    </div>
  `;
  $("#side-home-search")?.addEventListener("input", (event) => {
    state.home.term = event.target.value;
    renderSideHome();
  });
  if (hadFocus) {
    const search = $("#side-home-search");
    search?.focus({ preventScroll: true });
    search?.setSelectionRange(caret, caret);
  }
  side.querySelector("[data-side-home-button]")?.addEventListener("click", renderHome);
  side.querySelectorAll("[data-side-person]").forEach((button) => {
    button.addEventListener("click", () => selectPerson(button.dataset.sidePerson));
  });
}

function shouldShowSideHomeButton() {
  if (!state.person) return false;
  const main = $(".main");
  const homeButton = $("#home-button");
  const bottom = homeButton?.getBoundingClientRect().bottom ?? 0;
  return bottom < 0 || (main?.scrollTop || 0) > 140 || window.scrollY > 140;
}

function syncSideHomeButtonVisibility() {
  if (!state.person) return;
  const next = shouldShowSideHomeButton();
  if (next !== state.sideHomeButtonVisible) {
    renderSideHome();
  }
}

async function bulkDownloadSelected() {
  const kind = $("#bulk-kind")?.value || "all";
  await bulkDownload({
    personIds: [...state.selectedPeople],
    kinds: [kind],
    name: `selected-${kind}`,
  });
}

async function bulkDownload(payload) {
  const ok = await confirmAction({
    title: "Download ZIP?",
    message: "This can download many files from Assabile and may take a while.",
    confirmLabel: "Yes, download",
  });
  if (!ok) return;
  const result = await api("/api/bulk-download", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  window.open(result.publicPath, "_blank", "noreferrer");
  alert(`ZIP ready: ${result.count} files`);
}

function renderPersonContentCounts(person) {
  const rows = [
    ["recitations", "Rec"],
    ["anasheed", "Nasheed"],
    ["audioLessons", "Audio"],
    ["videoLessons", "Video lessons"],
    ["photos", "Photos"],
    ["videos", "Videos"],
  ]
    .map(([key, label]) => {
      const count = personCount(person, key);
      return count ? `<span class="mini-stat"><strong>${count}</strong> ${label}</span>` : "";
    })
    .join("");
  return rows;
}

async function downloadHomePersonImage(button, personId) {
  const person = state.people.find((item) => item.id === personId);
  if (!person?.image) return;
  button.disabled = true;
  const originalTitle = button.title;
  button.title = "Downloading...";
  try {
    const filename = person.image.split("/").pop() || `${person.id}.jpg`;
    const saved = await api("/api/download", {
      method: "POST",
      body: JSON.stringify({ url: person.image, filename, subdir: `${person.id}/profile` }),
    });
    button.title = `Saved ${saved.bytes} bytes`;
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

function homeTrackAt(index) {
  return state.homeVisibleTracks[index];
}

function homeTrackQueueItem(track) {
  if (!track) return null;
  const base = {
    kind: track.kind,
    id: track.id || track.mediaUrl || track.playerXml,
    title: track.title || "Untitled",
    creator: track.personName || "",
    personId: track.personId,
  };
  if (track.kind === "recitation") {
    return {
      ...base,
      playerXml: track.playerXml,
      title: track.title || "Recitation",
      duration: track.duration || "",
    };
  }
  return {
    ...base,
    kind: track.kind,
    mediaUrl: track.mediaUrl || track.id,
    poster: track.thumb || "",
  };
}

function homeTrackPlayableQueue() {
  return state.homeMatchedTracks.map(homeTrackQueueItem).filter((item) => item && (item.playerXml || item.mediaUrl));
}

async function playHomeTrack(index) {
  const track = homeTrackAt(index);
  const selected = homeTrackQueueItem(track);
  if (!selected) return;
  const queue = homeTrackPlayableQueue();
  const selectedIndex = queue.findIndex((item) => queueKey(item) === queueKey(selected));
  const action = await chooseQueueAction({
    title: selected.title,
    sourceLabel: "search results",
    sourceCount: queue.length,
  });
  if (!action) return;
  await applyQueueChoice(action, queue, Math.max(0, selectedIndex));
}

function addHomeTrack(button, index) {
  const item = homeTrackQueueItem(homeTrackAt(index));
  if (!item) return;
  appendToPlaylist([item], { play: false });
  button.title = "Added track";
}

async function downloadHomeTrack(button, index) {
  const item = homeTrackQueueItem(homeTrackAt(index));
  if (!item) return;
  button.disabled = true;
  const originalTitle = button.title;
  button.title = "Downloading...";
  try {
    const saved = await getCachedRecording(item);
    button.title = `Saved ${saved.bytes} bytes`;
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

async function goToHomeTrack(index) {
  const track = homeTrackAt(index);
  if (!track) return;
  await selectPerson(track.personId);
  state.tab = track.kind === "recitation" ? "recitations" : track.kind === "anasheed" ? "albums" : "audioLessons";
  renderTabs();
  renderPanel();
}

async function loadPeople() {
  const data = await api("/api/people");
  state.people = data.people;
  state.peopleById = new Map(state.people.map((person) => [person.id, person]));
  state.homeFilters = data.filters || state.homeFilters;
  state.homeFilters.riwayat = uniqueCanonicalRiwayat(state.homeFilters.riwayat || []);
  state.homeTracks = data.tracks || [];
  renderHome();
}

function renderPeople() {
  return;
}

async function selectPerson(id) {
  state.person = await api(`/api/person/${encodeURIComponent(id)}`);
  state.queue = [];
  state.recitationControls.collection = "all";
  state.tab = firstProfileTab();
  renderProfile();
  renderTabs();
  renderPanel();
  renderSideHome();
}

function renderProfile() {
  const person = state.person;
  const stats = Object.entries(person.tabs || {})
    .map(([key, value]) => `<span class="stat"><strong>${value}</strong><span class="meta">${countLabel(key)}</span></span>`)
    .join("");
  $("#profile").innerHTML = `
    ${person.banner ? `<div class="profile-banner"><img src="${person.banner}" alt=""></div>` : ""}
    <div>
      <h1>${person.name}</h1>
      <div class="arabic">${person.arabicName || ""}</div>
      <p>${person.bio || ""}</p>
      <div class="chips">${(person.roles || []).map((role) => `<span class="chip">${formatRole(role)}</span>`).join("")}</div>
      <div class="stat-grid">${stats}</div>
      <div class="bulk-toolbar profile-bulk">
        <select id="profile-bulk-kind">
          <option value="all">All files</option>
          <option value="recitations">Recitations</option>
          <option value="anasheed">Anasheed</option>
          <option value="audioLessons">Audio lessons</option>
          <option value="videoLessons">Video lessons</option>
          <option value="photos">Photos</option>
          <option value="videos">Videos</option>
        </select>
        <button class="button" type="button" data-profile-bulk-download>Download profile ZIP</button>
      </div>
    </div>
    <div class="profile-card">
      ${
        person.image
          ? `<img class="avatar avatar-large profile-image" src="${person.image}" loading="eager" alt="">`
          : `<span class="avatar avatar-large avatar-initial">${(person.name || "?").trim().slice(0, 1).toUpperCase()}</span>`
      }
      <div>
        <strong>${person.country || ""}</strong>
        <div><a class="tool-button inline-tool" href="${person.profileUrl}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a></div>
      </div>
    </div>
  `;
  $("[data-profile-bulk-download]")?.addEventListener("click", () => {
    const kind = $("#profile-bulk-kind")?.value || "all";
    bulkDownload({ personIds: [state.person.id], kinds: [kind], name: `${state.person.id}-${kind}` });
  });
}

function availableTabs() {
  const tabs = [];
  if (state.person.collections?.length) tabs.push({ id: "collections", label: tabLabel("Al-Massahef", tabContentCount("collections")) });
  if (state.person.recitations?.length) tabs.push({ id: "recitations", label: tabLabel("Recitations", tabContentCount("recitations")) });
  if (state.person.albums?.length) tabs.push({ id: "albums", label: tabLabel("Anasheed", tabContentCount("albums")) });
  if (state.person.audioLessons?.length) tabs.push({ id: "audioLessons", label: tabLabel("Audio Lessons", tabContentCount("audioLessons")) });
  if (state.person.videoLessons?.length) tabs.push({ id: "videoLessons", label: tabLabel("Video Lessons", tabContentCount("videoLessons")) });
  if (state.person.photos?.length) tabs.push({ id: "photos", label: tabLabel("Photos", tabContentCount("photos")) });
  if (state.person.videos?.length) tabs.push({ id: "videos", label: tabLabel("Videos", tabContentCount("videos")) });
  tabs.push({ id: "sameCountry", label: "Same Country" });
  tabs.push({ id: "comments", label: "Comments" });
  return tabs;
}

function tabContentCount(key) {
  if (key === "albums") return collectionRecordingCount(state.person.albums) || state.person.albums?.length || 0;
  if (key === "audioLessons") return collectionRecordingCount(state.person.audioLessons) || state.person.audioLessons?.length || 0;
  if (key === "videoLessons") return collectionRecordingCount(state.person.videoLessons) || state.person.videoLessons?.length || 0;
  return state.person[key]?.length || 0;
}

function collectionRecordingCount(items = []) {
  return items.reduce((total, item) => total + (item.recordings?.length || 0), 0);
}

function tabLabel(label, count) {
  return `${label} (${count})`;
}

function firstProfileTab() {
  return availableTabs()[0]?.id || "comments";
}

function renderTabs() {
  if (!availableTabs().some((tab) => tab.id === state.tab)) state.tab = firstProfileTab();
  $("#tabs").innerHTML = availableTabs()
    .map((tab) => `<button class="tab ${state.tab === tab.id ? "active" : ""}" data-tab="${tab.id}">${tab.label}</button>`)
    .join("");
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderTabs();
      renderPanel();
    });
  });
}

function renderPanel() {
  const renderers = {
    collections: renderCollections,
    recitations: renderRecitations,
    albums: () => renderRecordingCollections("Anasheed albums", state.person.albums || []),
    audioLessons: () => renderRecordingCollections("Audio lesson series", state.person.audioLessons || []),
    videoLessons: () => renderVideoLessonCollections("Video lesson series", state.person.videoLessons || []),
    photos: renderPhotos,
    videos: () => renderVideos("Videos", state.person.videos || []),
    sameCountry: renderSameCountry,
    comments: renderComments,
  };
  $("#panel").innerHTML = "";
  renderers[state.tab]();
}

function collectionTitle(collectionId) {
  const collection = (state.person.collections || []).find((item) => String(item.id) === String(collectionId));
  return collection?.title || "Unknown collection";
}

function collectionRecitationCounts() {
  const counts = new Map();
  (state.person.recitations || []).forEach((recitation) => {
    if (!recitation.collectionId) return;
    const key = String(recitation.collectionId);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function renderBio() {
  const person = state.person;
  const bio = person.bio || "No biography is stored for this profile.";
  const showInlineImage = person.image && !person.banner;
  const bioHtml = escapeHtml(bio)
    .split(/\n{2,}/)
    .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>Bio</h2></div>
    <section class="bio-panel">
      <div class="bio-body">
        ${
          showInlineImage
            ? `<img class="avatar avatar-large profile-image" src="${escapeHtml(person.image)}" loading="eager" alt="">`
            : `<span class="avatar avatar-large avatar-initial">${escapeHtml((person.name || "?").trim().slice(0, 1).toUpperCase())}</span>`
        }
        <div class="bio-copy">${bioHtml}</div>
      </div>
    </section>
    <div class="stat-grid">
      ${Object.entries(person.tabs || {})
        .map(([key, value]) => `<span class="stat"><strong>${value}</strong><span class="meta">${countLabel(key)}</span></span>`)
        .join("")}
    </div>
  `;
}

function renderSameCountry() {
  const people = state.people.filter((person) => person.country && person.country === state.person.country && person.id !== state.person.id);
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>From the same country</h2></div>
    <div class="grid">
      ${
        people
          .map(
            (person) => `
              <div class="item home-person">
                <div class="item-tools">
                  <button class="tool-button" data-same-country-person="${person.id}" title="Go to profile">&#10140;</button>
                </div>
                <div class="home-person-head">
                  ${
                    person.image
                      ? `<img class="avatar profile-image" src="${escapeHtml(person.image)}" loading="lazy" alt="">`
                      : `<span class="avatar avatar-initial">${(person.name || "?").trim().slice(0, 1).toUpperCase()}</span>`
                  }
                  <div>
                    <h3>${person.name}</h3>
                    <p class="muted">${person.country || ""}</p>
                  </div>
                </div>
                ${person.bio ? `<p class="home-person-bio">${escapeHtml(snippet(person.bio))}</p>` : ""}
                <div class="chips">${(person.roles || []).map((role) => `<span class="chip">${formatRole(role)}</span>`).join("")}</div>
              </div>
            `
          )
          .join("") || `<div class="empty"><h2>No local matches</h2><p>No other catalogue profiles share this country.</p></div>`
      }
    </div>
  `;
  document.querySelectorAll("[data-same-country-person]").forEach((button) => {
    button.addEventListener("click", () => selectPerson(button.dataset.sameCountryPerson));
  });
}

function renderComments() {
  const profileComments = state.person.comments || [];
  const recitationComments = (state.person.recitations || [])
    .filter((recitation) => recitation.comments && recitation.comments !== "0 comment")
    .map((recitation) => ({ title: recitationTitle(recitation), comments: recitation.comments }));
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>Comments</h2></div>
    <div class="notice">Comments are mirrored read-only from Assabile metadata where available.</div>
    <div class="grid">
      ${
        profileComments
          .map((comment) => `<div class="item"><h3>${escapeHtml(comment.author || "Visitor")}</h3>${comment.date ? `<p class="muted">${escapeHtml(comment.date)}</p>` : ""}<p>${escapeHtml(comment.text || "")}</p></div>`)
          .join("") ||
        recitationComments
          .map((item) => `<div class="item"><h3>${escapeHtml(item.title)}</h3><p class="muted">${escapeHtml(item.comments)}</p></div>`)
          .join("") ||
        `<div class="empty"><h2>No comments stored</h2><p>The local catalogue has no readable comment entries for this profile yet.</p></div>`
      }
    </div>
  `;
}

function renderCollections() {
  const counts = collectionRecitationCounts();
  const cards = state.person.collections
    .map((collection) => {
      const count = counts.get(String(collection.id)) || 0;
      const empty = count === 0;
      return `
      <button class="item collection-tile ${empty ? "empty-collection" : ""}" data-open-collection="${collection.id}" ${empty ? "disabled" : ""}>
        <h3>${collection.title}</h3>
        <p class="muted">${collection.category}</p>
        <p>${collection.riwayah}</p>
        <p class="collection-count">${empty ? "No recitation rows in local metadata" : `${count} recitation rows`}</p>
        ${empty ? "" : `<span class="tile-bulk" data-download-collection="${collection.id}">&#8681; ZIP</span>`}
      </button>
    `;
    })
    .join("");
  $("#panel").innerHTML = `<div class="toolbar"><h2>Al-Massahef</h2></div><div class="grid">${cards}</div>`;
  document.querySelectorAll("[data-open-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      state.recitationControls.collection = button.dataset.openCollection;
      state.tab = "recitations";
      renderTabs();
      renderPanel();
    });
  });
  document.querySelectorAll("[data-download-collection]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const collectionId = button.dataset.downloadCollection;
      const items = (state.person.recitations || [])
        .filter((recitation) => String(recitation.collectionId || "") === String(collectionId) && recitation.playerXml)
        .map((recitation) => ({
          kind: "recitations",
          personId: state.person.id,
          personName: state.person.name,
          title: recitationTitle(recitation),
          playerXml: recitation.playerXml,
        }));
      bulkDownload({ items, name: `${state.person.id}-collection-${collectionId}` });
    });
  });
}

async function syncCollection(button, ajaxUrl) {
  button.disabled = true;
  button.textContent = "Syncing...";
  try {
    const data = await api("/api/sync/recitations", {
      method: "POST",
      body: JSON.stringify({ ajaxUrl }),
    });
    state.syncedRecitations.set(ajaxUrl, data.recitations);
    state.person.recitations = mergeById(state.person.recitations || [], data.recitations);
    state.tab = "recitations";
    renderTabs();
    renderPanel();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Sync recitation rows";
  }
}

function mergeById(existing, incoming) {
  const rows = [...existing];
  const seen = new Set(rows.map((item) => item.id));
  incoming.forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      rows.push(item);
    }
  });
  return rows;
}

function renderRecitations() {
  const counts = collectionRecitationCounts();
  if (state.recitationControls.collection !== "all" && !counts.get(state.recitationControls.collection)) {
    state.recitationControls.collection = "all";
  }
  const recitations = filteredRecitations();
  state.queue = recitations;
  const collectionOptions = (state.person.collections || [])
    .filter((collection) => collection.id)
    .map((collection) => {
      const collectionId = String(collection.id);
      const count = counts.get(collectionId) || 0;
      const selected = state.recitationControls.collection === collectionId ? "selected" : "";
      const disabled = count === 0 ? "disabled" : "";
      const suffix = count === 0 ? " - empty" : ` (${count})`;
      return `<option value="${collection.id}" ${selected} ${disabled}>${collection.title}${suffix}</option>`;
    })
    .join("");
  const rows = recitations
    .map((recitation) => `
      <div class="item ${state.currentRecitationId === recitation.id ? "active-item" : ""}" data-recitation-card="${recitation.id}">
        <div class="item-tools">
          <button class="tool-button" data-play-recitation="${recitation.id}" title="Play / replace queue">&#9654;</button>
          <button class="tool-button" data-add-recitation="${recitation.id}" title="Add recitation">+</button>
          <button class="tool-button" data-download-player="${recitation.playerXml}" title="Download">&#8681;</button>
          ${recitation.detailUrl || recitation.detailPath ? `<a class="tool-button" href="${recitation.detailUrl || `https://www.assabile.com${recitation.detailPath}`}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>` : ""}
        </div>
        <h3>${recitationTitle(recitation)}</h3>
        <p class="muted">${recitation.duration || ""} ${recitation.revelation || ""} ${recitation.verses ? `${recitation.verses} verses` : ""}</p>
        <p>${recitation.riwayah || ""}</p>
        ${recitation.collectionId ? `<p class="muted">${collectionTitle(recitation.collectionId)}</p>` : ""}
      </div>
    `)
    .join("");
  $("#panel").innerHTML = `
    <div class="recitation-toolbar">
      <div class="toolbar-row">
        <label>
          <span>Sort by</span>
          <select id="recitation-sort">
            <option value="traditional" ${state.recitationControls.sort === "traditional" ? "selected" : ""}>Traditional order</option>
            <option value="name" ${state.recitationControls.sort === "name" ? "selected" : ""}>Name of Surah</option>
            <option value="chronological" ${state.recitationControls.sort === "chronological" ? "selected" : ""}>Chronological order</option>
            <option value="verses" ${state.recitationControls.sort === "verses" ? "selected" : ""}>Number of verses</option>
            <option value="listened" ${state.recitationControls.sort === "listened" ? "selected" : ""}>The most listened</option>
          </select>
        </label>
        <label>
          <span>Place of revelation</span>
          <select id="recitation-revelation">
            <option value="all" ${state.recitationControls.revelation === "all" ? "selected" : ""}>All</option>
            <option value="makiya" ${state.recitationControls.revelation === "makiya" ? "selected" : ""}>Makiya</option>
            <option value="madaniya" ${state.recitationControls.revelation === "madaniya" ? "selected" : ""}>Madaniya</option>
          </select>
        </label>
        <label>
          <span>Collection</span>
          <select id="recitation-collection">
            <option value="all" ${state.recitationControls.collection === "all" ? "selected" : ""}>All collections</option>
            ${collectionOptions}
          </select>
        </label>
      </div>
    </div>
    <div class="grid">${rows || `<div class="empty"><h2>No recitations</h2><p>Adjust the filters or sync another collection.</p></div>`}</div>
  `;
  bindRecitationToolbar();
  document.querySelectorAll("[data-play-recitation]").forEach((button) => {
    button.addEventListener("click", () => playRecitationById(button.dataset.playRecitation));
  });
  document.querySelectorAll("[data-add-recitation]").forEach((button) => {
    button.addEventListener("click", () => addRecitationById(button));
  });
  document.querySelectorAll("[data-download-player]").forEach((button) => {
    button.addEventListener("click", () => downloadPlayer(button, button.dataset.downloadPlayer));
  });
}

function filteredRecitations() {
  const controls = state.recitationControls;
  const rows = (state.person.recitations || []).filter((recitation) => {
    const revelation = (recitation.revelation || "").toLowerCase();
    const revelationOk = controls.revelation === "all" || revelation === controls.revelation;
    const collectionOk = controls.collection === "all" || String(recitation.collectionId || "") === controls.collection;
    return revelationOk && collectionOk;
  });

  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (controls.sort === "name") return (a.surah || "").localeCompare(b.surah || "");
    if (controls.sort === "chronological") return numeric(a.chronological, 999) - numeric(b.chronological, 999);
    if (controls.sort === "verses") return numeric(a.verses, 0) - numeric(b.verses, 0);
    if (controls.sort === "listened") return numeric(b.listens, 0) - numeric(a.listens, 0);
    return numeric(a.number, 999) - numeric(b.number, 999);
  });
  return sorted;
}

function bindRecitationToolbar() {
  $("#recitation-sort").addEventListener("change", (event) => {
    state.recitationControls.sort = event.target.value;
    renderPanel();
  });
  $("#recitation-revelation").addEventListener("change", (event) => {
    state.recitationControls.revelation = event.target.value;
    renderPanel();
  });
  $("#recitation-collection").addEventListener("change", (event) => {
    state.recitationControls.collection = event.target.value;
    renderPanel();
  });
}

function recitationQueueItems() {
  return filteredRecitations().map((recitation) => ({
    kind: "recitation",
    id: recitation.id,
    playerXml: recitation.playerXml,
    title: recitationTitle(recitation),
    creator: state.person?.name || "",
    duration: recitation.duration || "",
    recitation,
  }));
}

function updateActiveRecitationCard() {
  document.querySelectorAll("[data-recitation-card]").forEach((card) => {
    card.classList.toggle("active-item", card.dataset.recitationCard === state.currentRecitationId);
  });
  const current = currentQueueKey();
  document.querySelectorAll("[data-track-key]").forEach((node) => {
    node.classList.toggle("active-item", Boolean(current && node.dataset.trackKey === current));
  });
}

async function resolvePlayer(playerXml) {
  if (state.resolvedPlayers.has(playerXml)) return state.resolvedPlayers.get(playerXml);
  const data = await api("/api/sync/player", {
    method: "POST",
    body: JSON.stringify({ playerXml }),
  });
  state.resolvedPlayers.set(playerXml, data);
  return data;
}

async function playRecitationById(recitationId) {
  try {
    const recitation = (state.person.recitations || []).find((item) => item.id === recitationId);
    if (!recitation) return;
    const queue = recitationQueueItems();
    const index = queue.findIndex((item) => item.id === recitation.id);
    state.currentRecitationId = recitation.id;
    updateActiveRecitationCard();
    const action = await chooseQueueAction({
      title: recitationTitle(recitation),
      sourceLabel: "current recitation list",
      sourceCount: queue.length,
    });
    if (!action) return;
    await applyQueueChoice(action, queue, Math.max(0, index));
    updateActiveRecitationCard();
  } catch (error) {
    alert(error.message);
  }
}

function addRecitationById(button) {
  const recitation = (state.person.recitations || []).find((item) => item.id === button.dataset.addRecitation);
  if (!recitation) return;
  appendToPlaylist(
    [
    {
      kind: "recitation",
      id: recitation.id,
      playerXml: recitation.playerXml,
      title: recitationTitle(recitation),
      creator: state.person?.name || "",
      duration: recitation.duration || "",
      recitation,
    },
    ],
    { play: false }
  );
  button.title = "Added recitation";
}

async function cachePlayer(playerInput) {
  const playerXml = typeof playerInput === "string" ? playerInput : playerInput.playerXml;
  const media = await resolvePlayer(playerXml);
  const context = typeof playerInput === "string" ? {} : playerInput;
  return cacheMedia({ ...media, personId: context.personId, creator: context.creator || media.creator, title: context.title || media.title });
}

async function cacheMedia(media) {
  const pathExt = (() => {
    try {
      return new URL(media.mediaUrl).pathname.split(".").pop() || "";
    } catch {
      return "";
    }
  })();
  const ext = pathExt && pathExt.length <= 5 ? `.${pathExt}` : media.kind === "videoLesson" || media.kind === "video" ? ".mp4" : ".mp3";
  const filename = `${media.creator || state.person?.name || "assabile"} - ${media.title || "recording"}${ext}`;
  const saved = await api("/api/download", {
    method: "POST",
    body: JSON.stringify({ url: media.mediaUrl, filename, subdir: media.personId || state.person?.id || "home" }),
  });
  return { ...media, ...saved };
}

async function downloadPlayer(button, playerXml) {
  button.disabled = true;
  const originalTitle = button.title;
  button.title = "Downloading...";
  try {
    const saved = await cachePlayer({ playerXml, personId: state.person?.id, creator: state.person?.name });
    button.title = `Saved ${saved.bytes} bytes`;
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

function renderRecordingCollections(title, items) {
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>${title}</h2></div>
    <div class="grid">
      ${items
        .map((item, index) => {
          const key = item.url;
          const data = state.syncedRecordings.get(key);
          const recordings = item.recordings || data?.recordings || [];
          return `
          <div class="item recording-album" data-recording-album="${index}">
            <div class="item-tools">
              ${recordings.length ? `<button class="tool-button" data-play-album="${index}" title="Play album">&#9654;</button>` : ""}
              ${recordings.length ? `<button class="tool-button" data-add-album="${index}" title="Add album to queue">+&#9835;</button>` : ""}
              ${recordings.length ? `<button class="tool-button" data-download-recording-album="${index}" title="Download album ZIP">&#8681;</button>` : ""}
              <a class="tool-button" href="${item.url}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
            </div>
            <h3>${item.title}</h3>
            ${item.count ? `<p class="muted">${item.count} items</p>` : ""}
            <div class="recording-panel" data-recording-panel="${index}">
              ${renderRecordingRows(recordings)}
            </div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
  bindRecordingActions();
  document.querySelectorAll("[data-play-album]").forEach((button) => {
    button.addEventListener("click", () => playAlbumFromButton(button));
  });
  document.querySelectorAll("[data-add-album]").forEach((button) => {
    button.addEventListener("click", () => addAlbumFromButton(button));
  });
  document.querySelectorAll("[data-download-recording-album]").forEach((button) => {
    button.addEventListener("click", () => downloadRecordingAlbum(Number(button.dataset.downloadRecordingAlbum)));
  });
}

function renderRecordingRows(recordings) {
  if (!recordings.length) return `<p class="muted">No native recordings found on this source page.</p>`;
  return recordings
    .map((recording, index) => {
      const item = {
        mediaUrl: recording.mediaUrl,
        title: recording.title || "Recording",
        creator: recording.creator || "",
      };
      return `
      <div class="recording-row ${isCurrentQueueItem(item) ? "active-item" : ""}" data-recording-row data-recording-kind="audio" data-track-key="${escapeHtml(queueKey(item))}" data-media-url="${escapeHtml(recording.mediaUrl)}" data-recording-title="${escapeHtml(recording.title || "")}" data-recording-creator="${escapeHtml(recording.creator || "")}" data-recording-duration="${escapeHtml(recording.duration || "")}">
        <div class="item-tools">
          <button class="tool-button" data-play-recording="${escapeHtml(recording.mediaUrl)}" data-recording-title="${escapeHtml(recording.title || "")}" data-recording-creator="${escapeHtml(recording.creator || "")}" title="Play / replace album">&#9654;</button>
          <button class="tool-button" data-add-recording="${escapeHtml(recording.mediaUrl)}" data-recording-title="${escapeHtml(recording.title || "")}" data-recording-creator="${escapeHtml(recording.creator || "")}" title="Add track">+</button>
          <button class="tool-button" data-download-recording="${escapeHtml(recording.mediaUrl)}" data-recording-title="${escapeHtml(recording.title || "")}" data-recording-creator="${escapeHtml(recording.creator || "")}" title="Download">&#8681;</button>
        </div>
        <div>
          <strong>${index + 1}. ${escapeHtml(recording.title || "Untitled recording")}</strong>
          <span class="meta">${escapeHtml(recording.duration || "")} ${escapeHtml(recording.creator || "")}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

function downloadRecordingAlbum(albumIndex) {
  const album = [...document.querySelectorAll("[data-recording-album]")].find((node) => Number(node.dataset.recordingAlbum) === albumIndex);
  const items = visibleRecordingRows(album || document)
    .map(recordingFromRow)
    .map((recording) => ({
      kind: recording.kind === "videoLesson" ? "videoLessons" : "audio",
      personId: state.person.id,
      personName: state.person.name,
      title: recording.title,
      url: recording.mediaUrl,
    }));
  bulkDownload({ items, name: `${state.person.id}-album-${albumIndex + 1}` });
}

async function loadRecordings(button, sourceUrl) {
  button.disabled = true;
  button.textContent = "Loading...";
  try {
    const data = await api("/api/sync/recordings", {
      method: "POST",
      body: JSON.stringify({ sourceUrl }),
    });
    state.syncedRecordings.set(sourceUrl, data);
    renderPanel();
  } catch (error) {
    alert(error.message);
    button.textContent = "Load recordings";
  } finally {
    button.disabled = false;
  }
}

function bindRecordingActions() {
  document.querySelectorAll("[data-play-recording]").forEach((button) => {
    button.addEventListener("click", () => cacheRecording(button, true));
  });
  document.querySelectorAll("[data-add-recording]").forEach((button) => {
    button.addEventListener("click", () => addRecordingFromButton(button));
  });
  document.querySelectorAll("[data-download-recording]").forEach((button) => {
    button.addEventListener("click", () => cacheRecording(button, false));
  });
}

async function cacheRecording(button, shouldPlay) {
  button.disabled = true;
  const originalTitle = button.title;
  button.title = shouldPlay ? "Caching..." : "Downloading...";
  try {
    if (shouldPlay) {
      const didPlay = await playRecordingFromButton(button);
      button.title = didPlay ? "Playing" : originalTitle;
    } else {
      const row = button.closest("[data-recording-row]");
      const saved = await getCachedRecording(
        row
          ? recordingFromRow(row)
          : {
              mediaUrl: button.dataset.downloadRecording,
              title: button.dataset.recordingTitle,
              creator: button.dataset.recordingCreator,
            }
      );
      button.title = `Saved ${saved.bytes} bytes`;
    }
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

function visibleRecordingQueue() {
  return visibleRecordingRows().map(recordingFromRow).filter((item) => item.mediaUrl);
}

function visibleRecordingRows(root = document) {
  return [...root.querySelectorAll("[data-recording-row]")];
}

function recordingFromRow(row) {
  return {
    row,
    kind: row.dataset.recordingKind || "audio",
    mediaUrl: row.dataset.mediaUrl,
    title: row.dataset.recordingTitle || row.querySelector("strong")?.textContent || "Recording",
    creator: row.dataset.recordingCreator || "",
    poster: row.dataset.recordingPoster || "",
    duration: row.dataset.recordingDuration || "",
  };
}

function albumRecordingQueue(button) {
  const panel = button.closest("[data-recording-panel]") || button.closest(".recording-album")?.querySelector("[data-recording-panel]");
  return visibleRecordingRows(panel || document)
    .map((row) => ({
      row,
      kind: row.dataset.recordingKind || "audio",
      mediaUrl: row.dataset.mediaUrl,
      title: row.dataset.recordingTitle || row.querySelector("strong")?.textContent || "Recording",
      creator: row.dataset.recordingCreator || "",
      poster: row.dataset.recordingPoster || "",
      duration: row.dataset.recordingDuration || "",
    }))
    .filter((item) => item.mediaUrl);
}

function queueKey(item) {
  return item?.playerXml || item?.mediaUrl || item?.id || "";
}

function currentQueueKey() {
  return queueKey(state.recordingPlayer.queue[state.recordingPlayer.index]);
}

function isCurrentQueueItem(item) {
  const current = currentQueueKey();
  return Boolean(current && queueKey(item) === current);
}

function isCurrentHomeTrack(track) {
  return isCurrentQueueItem(homeTrackQueueItem(track));
}

function appendToPlaylist(items, options = {}) {
  const player = state.recordingPlayer;
  const existing = new Map(player.queue.map((item, index) => [queueKey(item), index]));
  let selectedIndex = -1;
  items.forEach((item) => {
    const key = queueKey(item);
    if (!existing.has(key)) {
      player.queue.push(item);
      existing.set(key, player.queue.length - 1);
    }
    if (options.selectedKey && key === options.selectedKey) selectedIndex = existing.get(key);
  });
  if (selectedIndex < 0 && Number.isInteger(options.selectedIndex)) {
    const item = items[options.selectedIndex];
    selectedIndex = existing.get(queueKey(item)) ?? -1;
  }
  if (options.play && selectedIndex >= 0) {
    return playRecordingAt(selectedIndex);
  }
  if (!document.querySelector(".recording-player-shell") && player.queue.length) {
    player.index = Math.max(0, player.index);
    renderRecordingPlayer(player.queue[player.index]);
    scrollQueueToNowPlaying();
    return Promise.resolve(player.index);
  }
  renderPlayerPlaylist();
  scrollQueueToNowPlaying();
  return Promise.resolve(selectedIndex);
}

function addRecordingFromButton(button) {
  const row = button.closest("[data-recording-row]");
  if (!row) return;
  appendToPlaylist([recordingFromRow(row)], { play: false });
  button.title = "Added track";
}

function playAlbumFromButton(button) {
  const queue = albumRecordingQueue(button);
  if (!queue.length) return;
  state.recordingPlayer.queue = queue;
  playRecordingAt(0);
}

function addAlbumFromButton(button) {
  const queue = albumRecordingQueue(button);
  appendToPlaylist(queue, { play: false });
  button.title = "Added album";
}

async function playRecordingFromButton(button) {
  const queue = albumRecordingQueue(button);
  const row = button.closest("[data-recording-row]");
  const index = queue.findIndex((item) => item.row === row);
  const safeIndex = Math.max(0, index);
  const action = await chooseQueueAction({
    title: queue[safeIndex]?.title || "Recording",
    sourceLabel: "album",
    sourceCount: queue.length,
  });
  if (!action) return false;
  await applyQueueChoice(action, queue, safeIndex);
  return true;
}

function replaceQueueAndPlay(queue, index) {
  state.recordingPlayer.queue = queue;
  return playRecordingAt(index);
}

async function applyQueueChoice(action, sourceQueue, selectedIndex) {
  const selected = sourceQueue[selectedIndex];
  if (!selected) return;
  if (action === "replace-track") {
    await replaceQueueAndPlay([selected], 0);
    return;
  }
  if (action === "add-track") {
    await appendToPlaylist([selected], { play: true, selectedKey: queueKey(selected) });
    return;
  }
  if (action === "add-source") {
    if (!state.recordingPlayer.queue.length) {
      await replaceQueueAndPlay(sourceQueue, selectedIndex);
      return;
    }
    await appendToPlaylist(sourceQueue, { play: true, selectedKey: queueKey(selected), selectedIndex });
    return;
  }
  if (action === "replace-source") {
    await replaceQueueAndPlay(sourceQueue, selectedIndex);
  }
}

function chooseQueueAction({ title, sourceLabel, sourceCount }) {
  return new Promise((resolve) => {
    document.querySelectorAll(".queue-choice-backdrop").forEach((node) => node.remove());
    const hasLiveQueue = Boolean(state.recordingPlayer.queue.length && document.querySelector(".recording-player-shell"));
    const hasSourceOption = sourceCount > 1;
    const backdrop = document.createElement("div");
    backdrop.className = "queue-choice-backdrop";
    backdrop.innerHTML = `
      <div class="queue-choice" role="dialog" aria-modal="true" aria-labelledby="queue-choice-title">
        <div>
          <h2 id="queue-choice-title">Play ${escapeHtml(title || "track")}</h2>
          <p class="muted">Choose how this affects the current queue.</p>
        </div>
        <div class="queue-choice-options">
          <button type="button" data-queue-choice="replace-track">
            <strong>${hasLiveQueue ? "Play only this track" : "Play this track"}</strong>
            <span>${hasLiveQueue ? "Replace the queue with this track and play it now." : "Start playback with this track."}</span>
          </button>
          ${
            hasLiveQueue
              ? `<button type="button" data-queue-choice="add-track">
            <strong>Add this track</strong>
            <span>Keep the queue, add this track, and play it now.</span>
          </button>`
              : ""
          }
          ${
            hasSourceOption
              ? `<button type="button" data-queue-choice="add-source">
            <strong>Add the ${escapeHtml(sourceLabel)}</strong>
            <span>${hasLiveQueue ? "Keep the queue and add" : "Start playback with"} ${sourceCount} tracks.</span>
          </button>`
              : ""
          }
          ${
            hasLiveQueue && hasSourceOption
              ? `<button type="button" data-queue-choice="replace-source">
            <strong>Replace with the ${escapeHtml(sourceLabel)}</strong>
            <span>Replace the queue with ${sourceCount} tracks and play this one.</span>
          </button>`
              : ""
          }
        </div>
        <button class="button secondary" type="button" data-queue-choice-cancel>Cancel</button>
      </div>
    `;
    const finish = (choice) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKeydown);
      resolve(choice);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(null);
    });
    backdrop.querySelectorAll("[data-queue-choice]").forEach((button) => {
      button.addEventListener("click", () => finish(button.dataset.queueChoice));
    });
    backdrop.querySelector("[data-queue-choice-cancel]").addEventListener("click", () => finish(null));
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-queue-choice]")?.focus();
  });
}

async function getCachedRecording(recording) {
  const key = recording.playerXml || recording.mediaUrl;
  if (!recording.playerXml && state.recordingPlayer.cache.has(key)) return state.recordingPlayer.cache.get(key);
  const saved = recording.playerXml ? await cachePlayer(recording) : await cacheMedia(recording);
  state.recordingPlayer.cache.set(key, saved);
  return saved;
}

async function playRecordingAt(index) {
  const player = state.recordingPlayer;
  const recording = player.queue[index];
  if (!recording) return;
  player.index = index;
  player.repeatLeft = player.repeat;
  player.trimStart = 0;
  player.trimEnd = 0;
  player.trimEnding = false;
  if (recording.kind === "recitation") {
    state.currentRecitationId = recording.id;
    updateActiveRecitationCard();
  } else {
    state.currentRecitationId = null;
    updateActiveRecitationCard();
  }
  const saved = await getCachedRecording(recording);
  renderRecordingPlayer(recording);
  const media = player.audio;
  media.src = saved.publicPath;
  media.load();
  media.play().catch(() => updateRecordingPlayerUi());
  updateRecordingPlayerUi();
  scrollQueueToNowPlaying();
}

function renderRecordingPlayer(recording) {
  document.querySelectorAll(".recording-player-shell").forEach((node) => node.remove());
  const shell = document.createElement("div");
  shell.className = `recording-player-shell corner-player${state.recordingPlayer.collapsed ? " collapsed" : ""}${state.recordingPlayer.videoFullsize ? " video-fullsize" : ""}`;
  if (!state.recordingPlayer.collapsed && state.recordingPlayer.savedSize) {
    shell.style.width = `${state.recordingPlayer.savedSize.width}px`;
    shell.style.height = `${state.recordingPlayer.savedSize.height}px`;
  }
  shell.innerHTML = `
    <div class="player-resize-grip player-resize-grip-nw" data-player-resize="nw" title="Resize player"></div>
    <div class="player-resize-grip player-resize-grip-se" data-player-resize="se" title="Resize player"></div>
    <div class="recording-player-header">
      <div class="recording-player-title">
        <strong>${escapeHtml(recording.title || "Recording")}</strong>
        <span>${escapeHtml(recording.creator || "")}</span>
      </div>
      <button class="icon-button" data-recording-collapse title="Collapse player">${state.recordingPlayer.collapsed ? "&#9650;" : "&#9660;"}</button>
      <button class="icon-button player-close-button" data-recording-close title="${state.recordingPlayer.queueLocked ? "Unlock queue before closing" : "Close player and clear queue"}" ${state.recordingPlayer.queueLocked ? "disabled" : ""}>&times;</button>
    </div>
    <div class="recording-player-body">
      ${
        recording.kind === "videoLesson" || recording.kind === "video"
          ? `<video class="recording-player-media recording-player-video" data-recording-media ${recording.poster ? `poster="${escapeHtml(recording.poster)}"` : ""}></video>`
          : `<audio class="recording-player-media recording-player-audio" data-recording-media></audio>`
      }
      <div class="recording-player-controls">
        <button class="icon-button" data-recording-prev title="Previous track">&#9198;</button>
        <button class="icon-button" data-recording-back title="Back 10 seconds">&minus;10</button>
        <button class="icon-button transport-button" data-recording-toggle title="Pause or resume">&#10074;&#10074;</button>
        <button class="icon-button" data-recording-forward title="Forward 10 seconds">+10</button>
        <button class="icon-button" data-recording-next title="Next track">&#9197;</button>
        <button class="icon-button ${state.recordingPlayer.shuffle ? "active" : ""}" data-recording-shuffle title="Shuffle">&#8644;</button>
        <button class="icon-button ${state.recordingPlayer.repeat ? "active" : ""}" data-recording-repeat title="Repeat current track">&#8635; ${state.recordingPlayer.repeat || "off"}</button>
        <button class="icon-button ${state.recordingPlayer.autoplay ? "active" : ""}" data-recording-autoplay title="Autoplay next track">&#9655; auto</button>
        <select class="speed-select" data-recording-speed title="Playback speed">
          ${[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => `<option value="${speed}" ${state.recordingPlayer.speed === speed ? "selected" : ""}>${speed}x</option>`).join("")}
        </select>
        ${(recording.kind === "videoLesson" || recording.kind === "video") ? `<button class="icon-button" data-video-fullsize title="Full size video">&#9974;</button>` : ""}
      </div>
      <div class="recording-seek-row">
        <span data-recording-current>0:00</span>
        <input class="recording-seek" type="range" min="0" max="1000" value="0" step="1" data-recording-seek>
        <span data-recording-remaining>-0:00</span>
      </div>
      <div class="trim-editor">
        <button class="trim-dialog-button" type="button" data-trim-dialog>Trim</button>
        <div class="trim-track" data-trim-track>
          <div class="trim-window" data-trim-window></div>
          <button class="trim-handle trim-start" data-trim-handle="start" type="button" title="Drag start"></button>
          <button class="trim-handle trim-end" data-trim-handle="end" type="button" title="Drag end"></button>
        </div>
      </div>
      <label class="recording-volume-row">
        <span>Volume</span>
        <input class="recording-volume" type="range" min="0" max="1" value="${Number.isFinite(state.recordingPlayer.volume) ? state.recordingPlayer.volume : 1}" step="0.01" data-recording-volume>
        <input class="recording-volume-number" type="number" min="0" max="100" value="${Math.round((Number.isFinite(state.recordingPlayer.volume) ? state.recordingPlayer.volume : 1) * 100)}" data-recording-volume-number>
        <span>%</span>
      </label>
      <div class="recording-playlist ${state.recordingPlayer.playlistCollapsed ? "collapsed" : ""}">
        <button class="playlist-toggle" data-playlist-collapse type="button">
          <span>Queue <span data-queue-count>${state.recordingPlayer.queue.length}</span></span>
          <span data-playlist-state>${state.recordingPlayer.playlistCollapsed ? "&#9650;" : "&#9660;"}</span>
        </button>
        <div class="queue-actions">
          <button class="playlist-lock ${state.recordingPlayer.queueLocked ? "active" : ""}" data-playlist-lock type="button" title="${state.recordingPlayer.queueLocked ? "Unlock queue" : "Lock queue"}">${state.recordingPlayer.queueLocked ? "&#128275;" : "&#128274;"}</button>
          <button class="playlist-clear" data-playlist-clear type="button" ${state.recordingPlayer.queueLocked ? "disabled" : ""}>Clear</button>
        </div>
        <div class="playlist-list" data-playlist-list></div>
      </div>
    </div>
  `;
  document.body.appendChild(shell);
  const media = shell.querySelector("[data-recording-media]");
  state.recordingPlayer.audio = media;
  media.volume = Number.isFinite(state.recordingPlayer.volume) ? state.recordingPlayer.volume : 1;
  media.playbackRate = Number.isFinite(state.recordingPlayer.speed) ? state.recordingPlayer.speed : 1;
  media.addEventListener("timeupdate", updateRecordingPlayerUi);
  media.addEventListener("loadedmetadata", updateRecordingPlayerUi);
  media.addEventListener("durationchange", updateRecordingPlayerUi);
  media.addEventListener("play", updateRecordingPlayerUi);
  media.addEventListener("pause", updateRecordingPlayerUi);
  media.addEventListener("seeked", updateRecordingPlayerUi);
  media.addEventListener("volumechange", syncRecordingVolume);
  media.addEventListener("ended", handleRecordingEnded);
  shell.querySelector("[data-recording-collapse]").addEventListener("click", toggleRecordingPlayerCollapse);
  shell.querySelector("[data-recording-close]").addEventListener("click", closeRecordingPlayer);
  shell.querySelector("[data-recording-toggle]").addEventListener("click", toggleRecordingPlayback);
  shell.querySelector("[data-recording-back]").addEventListener("click", () => skipRecording(-10));
  shell.querySelector("[data-recording-forward]").addEventListener("click", () => skipRecording(10));
  shell.querySelector("[data-recording-prev]").addEventListener("click", () => playAdjacentRecording(-1));
  shell.querySelector("[data-recording-next]").addEventListener("click", () => playAdjacentRecording(1));
  shell.querySelector("[data-recording-shuffle]").addEventListener("click", toggleRecordingShuffle);
  shell.querySelector("[data-recording-repeat]").addEventListener("click", cycleRecordingRepeat);
  shell.querySelector("[data-recording-autoplay]").addEventListener("click", toggleRecordingAutoplay);
  shell.querySelector("[data-recording-speed]").addEventListener("change", setRecordingSpeed);
  shell.querySelector("[data-video-fullsize]")?.addEventListener("click", toggleVideoFullsize);
  shell.querySelector("[data-recording-seek]").addEventListener("input", seekRecording);
  shell.querySelector("[data-recording-seek]").addEventListener("change", seekRecording);
  bindTrimHandles(shell);
  bindPlayerResize(shell);
  shell.querySelector("[data-recording-volume]").addEventListener("input", setRecordingVolume);
  shell.querySelector("[data-recording-volume-number]").addEventListener("input", setRecordingVolume);
  shell.querySelector("[data-trim-dialog]").addEventListener("click", openTrimDialog);
  shell.querySelector("[data-playlist-collapse]").addEventListener("click", togglePlaylistCollapse);
  shell.querySelector("[data-playlist-clear]").addEventListener("click", clearPlaylist);
  shell.querySelector("[data-playlist-lock]").addEventListener("click", toggleQueueLock);
  renderPlayerPlaylist();
  scrollQueueToNowPlaying();
}

function renderPlayerPlaylist() {
  const shell = document.querySelector(".recording-player-shell");
  const list = shell?.querySelector("[data-playlist-list]");
  if (!shell || !list) return;
  const player = state.recordingPlayer;
  list.innerHTML = player.queue
    .map(
      (item, index) => `
        <div class="playlist-row ${index === player.index ? "active" : ""}" data-playlist-index="${index}">
          <button class="queue-drag-handle" data-queue-drag="${index}" draggable="${player.queueLocked ? "false" : "true"}" title="${player.queueLocked ? "Queue locked" : "Drag to reorder"}" type="button" ${player.queueLocked ? "disabled" : ""}>&#9776;</button>
          <button class="playlist-track" data-playlist-play="${index}" type="button">
            <strong>${escapeHtml(item.title || "Recording")}</strong>
            <span>${escapeHtml([item.creator, item.duration].filter(Boolean).join(" - "))}</span>
          </button>
          <button class="queue-remove" data-queue-remove="${index}" type="button" title="${player.queueLocked ? "Queue locked" : "Remove from queue"}" ${player.queueLocked ? "disabled" : ""}>&times;</button>
        </div>
      `
    )
    .join("");
  shell.querySelectorAll("[data-playlist-play]").forEach((button) => {
    button.addEventListener("click", () => playRecordingAt(Number(button.dataset.playlistPlay)));
  });
  shell.querySelectorAll("[data-queue-drag]").forEach((handle) => {
    handle.addEventListener("dragstart", (event) => {
      if (state.recordingPlayer.queueLocked) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", handle.dataset.queueDrag);
    });
  });
  shell.querySelectorAll("[data-queue-remove]").forEach((button) => {
    button.addEventListener("click", () => removeQueueItem(Number(button.dataset.queueRemove)));
  });
  shell.querySelectorAll("[data-playlist-index]").forEach((row) => {
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drag-over");
      reorderQueue(Number(event.dataTransfer.getData("text/plain")), Number(row.dataset.playlistIndex));
    });
  });
  const stateLabel = shell.querySelector("[data-playlist-state]");
  if (stateLabel) stateLabel.innerHTML = player.playlistCollapsed ? "&#9650;" : "&#9660;";
  const count = shell.querySelector("[data-queue-count]");
  if (count) count.textContent = String(player.queue.length);
}

function removeQueueItem(index) {
  const player = state.recordingPlayer;
  if (player.queueLocked) return;
  if (index < 0 || index >= player.queue.length) return;
  const removingCurrent = index === player.index;
  player.queue.splice(index, 1);
  if (!player.queue.length) {
    closeRecordingPlayerWithoutConfirm();
    return;
  }
  if (index < player.index) player.index -= 1;
  if (removingCurrent) {
    player.index = Math.min(index, player.queue.length - 1);
    playRecordingAt(player.index);
    return;
  }
  renderPlayerPlaylist();
  updateActiveRecitationCard();
}

function scrollQueueToNowPlaying() {
  requestAnimationFrame(() => {
    const shell = document.querySelector(".recording-player-shell");
    const row = shell?.querySelector(`.playlist-row[data-playlist-index="${state.recordingPlayer.index}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });
}

function reorderQueue(from, to) {
  const player = state.recordingPlayer;
  if (player.queueLocked) return;
  if (from === to || from < 0 || to < 0 || from >= player.queue.length || to >= player.queue.length) return;
  const [item] = player.queue.splice(from, 1);
  player.queue.splice(to, 0, item);
  if (player.index === from) player.index = to;
  else if (from < player.index && to >= player.index) player.index -= 1;
  else if (from > player.index && to <= player.index) player.index += 1;
  renderPlayerPlaylist();
}

function togglePlaylistCollapse() {
  state.recordingPlayer.playlistCollapsed = !state.recordingPlayer.playlistCollapsed;
  const playlist = document.querySelector(".recording-playlist");
  if (playlist) playlist.classList.toggle("collapsed", state.recordingPlayer.playlistCollapsed);
  renderPlayerPlaylist();
  if (!state.recordingPlayer.playlistCollapsed) scrollQueueToNowPlaying();
}

async function confirmAction({ title, message, confirmLabel = "Yes", cancelLabel = "No" }) {
  return new Promise((resolve) => {
    document.querySelectorAll(".confirm-backdrop").forEach((node) => node.remove());
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-backdrop";
    backdrop.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div>
          <h2 id="confirm-title">${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="confirm-actions">
          <button class="button secondary" type="button" data-confirm-no>${escapeHtml(cancelLabel)}</button>
          <button class="button danger" type="button" data-confirm-yes>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const finish = (value) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") finish(false);
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop.querySelector("[data-confirm-no]").addEventListener("click", () => finish(false));
    backdrop.querySelector("[data-confirm-yes]").addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-confirm-no]")?.focus();
  });
}

async function clearPlaylist() {
  if (state.recordingPlayer.queueLocked) return;
  const ok = await confirmAction({
    title: "Clear queue?",
    message: "This will remove every queued track except the current track.",
    confirmLabel: "Yes, clear",
  });
  if (!ok) return;
  const player = state.recordingPlayer;
  const current = player.queue[player.index];
  if (current) {
    player.queue = [current];
    player.index = 0;
    renderPlayerPlaylist();
    return;
  }
  player.queue = [];
  player.index = -1;
  renderPlayerPlaylist();
}

function toggleQueueLock() {
  state.recordingPlayer.queueLocked = !state.recordingPlayer.queueLocked;
  renderPlayerPlaylist();
}

async function closeRecordingPlayer() {
  const ok = await confirmAction({
    title: "Close player?",
    message: "This will stop playback and clear the whole queue, including the current track.",
    confirmLabel: "Yes, close",
  });
  if (!ok) return;
  closeRecordingPlayerWithoutConfirm();
}

function closeRecordingPlayerWithoutConfirm() {
  const player = state.recordingPlayer;
  if (player.audio) {
    player.audio.pause();
    player.audio.removeAttribute("src");
    player.audio.load();
  }
  player.queue = [];
  player.index = -1;
  player.repeatLeft = 0;
  player.audio = null;
  state.currentRecitationId = null;
  updateActiveRecitationCard();
  document.querySelectorAll(".recording-player-shell").forEach((node) => node.remove());
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function updateRecordingPlayerUi() {
  const audio = state.recordingPlayer.audio;
  const shell = audio?.closest(".recording-player-shell");
  if (!audio || !shell) return;
  const seek = shell.querySelector("[data-recording-seek]");
  const current = shell.querySelector("[data-recording-current]");
  const remaining = shell.querySelector("[data-recording-remaining]");
  const toggle = shell.querySelector("[data-recording-toggle]");
  const repeat = shell.querySelector("[data-recording-repeat]");
  const shuffle = shell.querySelector("[data-recording-shuffle]");
  const autoplay = shell.querySelector("[data-recording-autoplay]");
  const volume = shell.querySelector("[data-recording-volume]");
  const volumeNumber = shell.querySelector("[data-recording-volume-number]");
  const speed = shell.querySelector("[data-recording-speed]");
  const lock = shell.querySelector("[data-playlist-lock]");
  if (seek && Number.isFinite(audio.duration) && audio.duration > 0) seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  if (seek) {
    const percent = Number(seek.value || 0) / 10;
    seek.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percent}%, #c3ddd7 ${percent}%, #c3ddd7 100%)`;
  }
  if (current) current.textContent = formatTime(audio.currentTime);
  if (remaining) remaining.textContent = Number.isFinite(audio.duration) ? `-${formatTime(Math.max(0, audio.duration - audio.currentTime))}` : "-0:00";
  updateTrimUi(shell);
  enforceTrimBounds(audio);
  if (toggle) toggle.innerHTML = audio.paused ? "&#9654;" : "&#10074;&#10074;";
  if (repeat) {
    repeat.innerHTML = `&#8635; ${state.recordingPlayer.repeat || "off"}`;
    repeat.classList.toggle("active", state.recordingPlayer.repeat > 0);
  }
  if (shuffle) shuffle.classList.toggle("active", state.recordingPlayer.shuffle);
  if (autoplay) autoplay.classList.toggle("active", state.recordingPlayer.autoplay);
  if (volume) volume.value = String(state.recordingPlayer.volume);
  if (volumeNumber) volumeNumber.value = String(Math.round(state.recordingPlayer.volume * 100));
  if (speed) speed.value = String(state.recordingPlayer.speed);
  if (lock) {
    lock.innerHTML = state.recordingPlayer.queueLocked ? "&#128275;" : "&#128274;";
    lock.title = state.recordingPlayer.queueLocked ? "Unlock queue" : "Lock queue";
  }
  const collapse = shell.querySelector("[data-recording-collapse]");
  if (collapse) collapse.innerHTML = state.recordingPlayer.collapsed ? "&#9650;" : "&#9660;";
}

function seekRecording(event) {
  const audio = state.recordingPlayer.audio;
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  safeSeek((Number(event.target.value) / 1000) * audio.duration);
  updateRecordingPlayerUi();
}

function setTrimStartFromRatio(ratio) {
  const media = state.recordingPlayer.audio;
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
  const value = Math.max(0, Math.min(1, ratio)) * media.duration;
  const end = state.recordingPlayer.trimEnd || media.duration;
  state.recordingPlayer.trimStart = Math.max(0, Math.min(value, Math.max(0, end - 1)));
  if (media.currentTime < state.recordingPlayer.trimStart) safeSeek(state.recordingPlayer.trimStart);
  updateRecordingPlayerUi();
}

function setTrimEndFromRatio(ratio) {
  const media = state.recordingPlayer.audio;
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
  const value = Math.max(0, Math.min(1, ratio)) * media.duration;
  state.recordingPlayer.trimEnd = Math.min(media.duration, Math.max(value, state.recordingPlayer.trimStart + 1));
  if (media.currentTime > state.recordingPlayer.trimEnd) safeSeek(state.recordingPlayer.trimStart);
  updateRecordingPlayerUi();
}

function parseTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.slice(-3).reduce((total, part, index) => total + part * [3600, 60, 1][index], 0);
}

function openTrimDialog() {
  const media = state.recordingPlayer.audio;
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
  document.querySelectorAll(".confirm-backdrop").forEach((node) => node.remove());
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-backdrop";
  backdrop.innerHTML = `
    <div class="confirm-box trim-box" role="dialog" aria-modal="true" aria-labelledby="trim-title">
      <div>
        <h2 id="trim-title">Trim playback</h2>
        <p>Enter times as seconds, mm:ss, or hh:mm:ss.</p>
      </div>
      <label>Start <input type="text" data-trim-start-input value="${formatTime(state.recordingPlayer.trimStart || 0)}"></label>
      <label>End <input type="text" data-trim-end-input value="${formatTime(state.recordingPlayer.trimEnd || media.duration)}"></label>
      <div class="confirm-actions">
        <button class="button secondary" type="button" data-trim-clear>Clear</button>
        <button class="button secondary" type="button" data-confirm-no>No</button>
        <button class="button" type="button" data-confirm-yes>Yes</button>
      </div>
    </div>
  `;
  const finish = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKeydown);
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") finish();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) finish();
  });
  backdrop.querySelector("[data-confirm-no]").addEventListener("click", finish);
  backdrop.querySelector("[data-trim-clear]").addEventListener("click", () => {
    state.recordingPlayer.trimStart = 0;
    state.recordingPlayer.trimEnd = 0;
    updateRecordingPlayerUi();
    finish();
  });
  backdrop.querySelector("[data-confirm-yes]").addEventListener("click", () => {
    const start = parseTimeInput(backdrop.querySelector("[data-trim-start-input]").value);
    const end = parseTimeInput(backdrop.querySelector("[data-trim-end-input]").value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      alert("Enter a valid start time and an end time after it.");
      return;
    }
    state.recordingPlayer.trimStart = Math.max(0, Math.min(media.duration - 1, start));
    state.recordingPlayer.trimEnd = Math.min(media.duration, Math.max(state.recordingPlayer.trimStart + 1, end));
    if (media.currentTime < state.recordingPlayer.trimStart || media.currentTime > state.recordingPlayer.trimEnd) safeSeek(state.recordingPlayer.trimStart);
    updateRecordingPlayerUi();
    finish();
  });
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-trim-start-input]")?.focus();
}

function bindTrimHandles(shell) {
  shell.querySelectorAll("[data-trim-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        const track = shell.querySelector("[data-trim-track]");
        const rect = track.getBoundingClientRect();
        const ratio = rect.width ? (moveEvent.clientX - rect.left) / rect.width : 0;
        if (handle.dataset.trimHandle === "start") setTrimStartFromRatio(ratio);
        else setTrimEndFromRatio(ratio);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
      move(event);
    });
  });
}

function updateTrimUi(shell) {
  const media = state.recordingPlayer.audio;
  const startHandle = shell.querySelector("[data-trim-handle='start']");
  const endHandle = shell.querySelector("[data-trim-handle='end']");
  const windowNode = shell.querySelector("[data-trim-window]");
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0 || !startHandle || !endHandle || !windowNode) return;
  const start = Math.max(0, Math.min(1, (state.recordingPlayer.trimStart || 0) / media.duration));
  const end = Math.max(start, Math.min(1, (state.recordingPlayer.trimEnd || media.duration) / media.duration));
  startHandle.style.left = `${start * 100}%`;
  endHandle.style.left = `${end * 100}%`;
  windowNode.style.left = `${start * 100}%`;
  windowNode.style.width = `${Math.max(0, end - start) * 100}%`;
}

function bindPlayerResize(shell) {
  shell.querySelectorAll("[data-player-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (state.recordingPlayer.collapsed || state.recordingPlayer.videoFullsize) return;
      event.preventDefault();
      document.body.classList.add("player-resizing");
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = shell.getBoundingClientRect().width;
      const startHeight = shell.getBoundingClientRect().height;
      const direction = handle.dataset.playerResize || "nw";
      const move = (moveEvent) => {
        moveEvent.preventDefault();
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const margin = window.matchMedia("(max-width: 720px)").matches ? 16 : 36;
        const minWidth = Math.min(460, Math.max(320, viewportWidth - margin));
        const minHeight = Math.min(430, Math.max(320, viewportHeight - margin));
        const maxWidth = Math.max(minWidth, viewportWidth - margin);
        const maxHeight = Math.max(minHeight, viewportHeight - margin);
        const fixedCornerDirection = direction === "se" && getComputedStyle(shell).position === "fixed";
        const deltaX = direction === "se" && !fixedCornerDirection ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        const deltaY = direction === "se" && !fixedCornerDirection ? moveEvent.clientY - startY : startY - moveEvent.clientY;
        const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
        const nextHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + deltaY));
        shell.style.width = `${nextWidth}px`;
        shell.style.height = `${nextHeight}px`;
        state.recordingPlayer.savedSize = { width: nextWidth, height: nextHeight };
      };
      const up = () => {
        document.body.classList.remove("player-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("pointercancel", up, { once: true });
    });
  });
}

function safeSeek(seconds) {
  const media = state.recordingPlayer.audio;
  if (!media || !Number.isFinite(seconds)) return;
  const target = Number.isFinite(media.duration) && media.duration > 0 ? Math.max(0, Math.min(media.duration, seconds)) : Math.max(0, seconds);
  try {
    if (typeof media.fastSeek === "function") media.fastSeek(target);
    else media.currentTime = target;
  } catch {
    try {
      media.currentTime = target;
    } catch {
      updateRecordingPlayerUi();
    }
  }
}

function enforceTrimBounds(media) {
  if (!media || state.recordingPlayer.trimEnding) return;
  const start = state.recordingPlayer.trimStart || 0;
  const end = state.recordingPlayer.trimEnd || 0;
  if (start > 0 && media.currentTime < start) safeSeek(start);
  if (end > start && media.currentTime >= end - 0.15) {
    state.recordingPlayer.trimEnding = true;
    safeSeek(start);
    if (state.recordingPlayer.autoplay) {
      playAdjacentRecording(1);
    } else {
      media.pause();
    }
    state.recordingPlayer.trimEnding = false;
  }
}

function toggleRecordingPlayback() {
  const audio = state.recordingPlayer.audio;
  if (!audio) return;
  if (audio.paused) audio.play().catch(() => updateRecordingPlayerUi());
  else audio.pause();
  updateRecordingPlayerUi();
}

function setRecordingVolume(event) {
  const raw = Number(event.target.value);
  const value = event.target.matches("[data-recording-volume-number]") ? raw / 100 : raw;
  state.recordingPlayer.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  localStorage.setItem("assabile-player-volume", String(state.recordingPlayer.volume));
  if (state.recordingPlayer.audio) state.recordingPlayer.audio.volume = state.recordingPlayer.volume;
  updateRecordingPlayerUi();
}

function syncRecordingVolume() {
  const audio = state.recordingPlayer.audio;
  if (!audio) return;
  state.recordingPlayer.volume = audio.volume;
  localStorage.setItem("assabile-player-volume", String(state.recordingPlayer.volume));
  updateRecordingPlayerUi();
}

function setRecordingSpeed(event) {
  const value = Number(event.target.value);
  state.recordingPlayer.speed = Number.isFinite(value) ? Math.max(0.25, Math.min(4, value)) : 1;
  localStorage.setItem("assabile-player-speed", String(state.recordingPlayer.speed));
  if (state.recordingPlayer.audio) state.recordingPlayer.audio.playbackRate = state.recordingPlayer.speed;
  updateRecordingPlayerUi();
}

function toggleVideoFullsize() {
  state.recordingPlayer.videoFullsize = !state.recordingPlayer.videoFullsize;
  const shell = document.querySelector(".recording-player-shell");
  if (!shell) return;
  shell.classList.toggle("video-fullsize", state.recordingPlayer.videoFullsize);
  if (state.recordingPlayer.videoFullsize) {
    const rect = shell.getBoundingClientRect();
    state.recordingPlayer.fullsizeSavedSize = state.recordingPlayer.savedSize || { width: rect.width, height: rect.height };
    shell.style.width = "";
    shell.style.height = "";
  } else if (!state.recordingPlayer.collapsed) {
    const size = state.recordingPlayer.fullsizeSavedSize || state.recordingPlayer.savedSize;
    if (size) {
      state.recordingPlayer.savedSize = size;
      shell.style.width = `${size.width}px`;
      shell.style.height = `${size.height}px`;
    }
    state.recordingPlayer.fullsizeSavedSize = null;
  }
}

function skipRecording(seconds) {
  const audio = state.recordingPlayer.audio;
  if (!audio) return;
  const target = Math.max(0, audio.currentTime + seconds);
  safeSeek(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(audio.duration, target) : target);
  updateRecordingPlayerUi();
}

function cycleRecordingRepeat() {
  state.recordingPlayer.repeat = (state.recordingPlayer.repeat + 1) % 4;
  state.recordingPlayer.repeatLeft = state.recordingPlayer.repeat;
  updateRecordingPlayerUi();
}

function toggleRecordingShuffle() {
  state.recordingPlayer.shuffle = !state.recordingPlayer.shuffle;
  updateRecordingPlayerUi();
}

function toggleRecordingAutoplay() {
  state.recordingPlayer.autoplay = !state.recordingPlayer.autoplay;
  localStorage.setItem("assabile-player-autoplay", String(state.recordingPlayer.autoplay));
  updateRecordingPlayerUi();
}

function toggleRecordingPlayerCollapse() {
  const shell = document.querySelector(".recording-player-shell");
  if (shell && !state.recordingPlayer.collapsed) {
    const rect = shell.getBoundingClientRect();
    state.recordingPlayer.savedSize = { width: rect.width, height: rect.height };
    shell.style.width = "";
    shell.style.height = "";
  }
  state.recordingPlayer.collapsed = !state.recordingPlayer.collapsed;
  if (shell) {
    shell.classList.toggle("collapsed", state.recordingPlayer.collapsed);
    if (!state.recordingPlayer.collapsed && state.recordingPlayer.savedSize && !state.recordingPlayer.videoFullsize) {
      shell.style.width = `${state.recordingPlayer.savedSize.width}px`;
      shell.style.height = `${state.recordingPlayer.savedSize.height}px`;
    }
  }
  updateRecordingPlayerUi();
  if (!state.recordingPlayer.collapsed) scrollQueueToNowPlaying();
}

function nextRecordingIndex(direction) {
  const player = state.recordingPlayer;
  if (!player.queue.length) return -1;
  if (player.shuffle && player.queue.length > 1) {
    let next = player.index;
    while (next === player.index) next = Math.floor(Math.random() * player.queue.length);
    return next;
  }
  return (player.index + direction + player.queue.length) % player.queue.length;
}

function playAdjacentRecording(direction) {
  const index = nextRecordingIndex(direction);
  if (index >= 0) playRecordingAt(index);
}

function handleRecordingEnded() {
  const player = state.recordingPlayer;
  if (player.repeatLeft > 0 && player.audio) {
    player.repeatLeft -= 1;
    player.audio.currentTime = 0;
    player.audio.play();
    return;
  }
  if (!player.autoplay) {
    updateRecordingPlayerUi();
    return;
  }
  playAdjacentRecording(1);
}

function renderLinkCards(title, items) {
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>${title}</h2></div>
    <div class="grid">
      ${items
        .map((item) => `
          <div class="item">
            <div class="item-tools">
              <a class="tool-button" href="${item.url}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
            </div>
            <h3>${item.title}</h3>
            ${item.count ? `<p class="muted">${item.count} items</p>` : ""}
          </div>
        `)
        .join("")}
    </div>
  `;
}

function renderVideoLessonCollections(title, items) {
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>${title}</h2></div>
    <div class="grid">
      ${items
        .map((series, seriesIndex) => {
          const episodes = series.recordings || [];
          return `
          <div class="item recording-album" data-video-series="${seriesIndex}">
            <div class="item-tools">
              ${episodes.length ? `<button class="tool-button" data-play-album="${seriesIndex}" title="Play video album">&#9654;</button>` : ""}
              ${episodes.length ? `<button class="tool-button" data-add-album="${seriesIndex}" title="Add video album to queue">+&#9835;</button>` : ""}
              ${episodes.length ? `<button class="tool-button" data-download-video-album="${seriesIndex}" title="Download video album ZIP">&#8681;</button>` : ""}
              <a class="tool-button" href="${escapeHtml(series.url || "#")}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
            </div>
            <h3>${escapeHtml(series.title || "Video series")}</h3>
            <p class="muted">${episodes.length ? `${episodes.length} episodes` : "No native episode rows found yet"}</p>
            <div class="recording-panel" data-recording-panel="${seriesIndex}">
              ${renderVideoLessonRows(episodes, seriesIndex)}
            </div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
  bindRecordingActions();
  document.querySelectorAll("[data-play-album]").forEach((button) => {
    button.addEventListener("click", () => playAlbumFromButton(button));
  });
  document.querySelectorAll("[data-add-album]").forEach((button) => {
    button.addEventListener("click", () => addAlbumFromButton(button));
  });
  document.querySelectorAll("[data-download-video-album]").forEach((button) => {
    button.addEventListener("click", () => downloadVideoAlbum(Number(button.dataset.downloadVideoAlbum)));
  });
}

function renderVideoLessonRows(episodes, seriesIndex) {
  if (!episodes.length) return `<p class="muted">No native video episodes found on this source page.</p>`;
  return episodes
    .map((episode, episodeIndex) => {
      const source = bestVideoSource(episode);
      return `
      <div class="recording-row ${isCurrentQueueItem({ mediaUrl: source?.url }) ? "active-item" : ""}" data-recording-row data-track-key="${escapeHtml(queueKey({ mediaUrl: source?.url }))}" data-video-lesson-row="${seriesIndex}-${episodeIndex}" data-recording-kind="videoLesson" data-media-url="${escapeHtml(source?.url || "")}" data-recording-title="${escapeHtml(episode.title || "Episode")}" data-recording-creator="${escapeHtml(state.person?.name || "")}" data-recording-poster="${escapeHtml(episode.thumb || "")}" data-recording-duration="${escapeHtml(episode.duration || "")}">
        <div class="item-tools">
          ${source ? `<button class="tool-button" data-play-recording="${escapeHtml(source.url)}" data-recording-title="${escapeHtml(episode.title || "")}" data-recording-creator="${escapeHtml(state.person?.name || "")}" title="Play / replace album">&#9654;</button>` : ""}
          ${source ? `<button class="tool-button" data-add-recording="${escapeHtml(source.url)}" data-recording-title="${escapeHtml(episode.title || "")}" data-recording-creator="${escapeHtml(state.person?.name || "")}" title="Add track">+</button>` : ""}
          ${source ? `<button class="tool-button" data-download-recording="${escapeHtml(source.url)}" data-recording-title="${escapeHtml(episode.title || "")}" data-recording-creator="${escapeHtml(state.person?.name || "")}" title="Download">&#8681;</button>` : ""}
          <a class="tool-button" href="${escapeHtml(episode.url || "#")}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
        </div>
        <div>
          <strong>${episodeIndex + 1}. ${escapeHtml(episode.title || "Episode")}</strong>
          <span class="meta">${escapeHtml(episode.duration || "")}</span>
          ${episode.thumb ? `<img class="video-poster" src="${escapeHtml(episode.thumb)}" loading="lazy" alt="">` : ""}
        </div>
      </div>
    `;
    })
    .join("");
}

function downloadVideoAlbum(seriesIndex) {
  const series = state.person.videoLessons?.[seriesIndex];
  const items = (series?.recordings || [])
    .map((episode) => {
      const source = bestVideoSource(episode);
      return source
        ? {
            kind: "videoLessons",
            personId: state.person.id,
            personName: state.person.name,
            title: episode.title || "Video lesson",
            url: source.url,
          }
        : null;
    })
    .filter(Boolean);
  bulkDownload({ items, name: `${state.person.id}-${series?.title || "video-lessons"}` });
}

function renderVideos(title, items) {
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>${title}</h2>${items.length ? `<button class="button" type="button" data-play-video-list>Play all</button>` : ""}</div>
    <div class="grid">
      ${items
        .map((item, index) => {
          const source = bestVideoSource(item);
          const queueItem = profileVideoQueueItem(item);
          return `
          <div class="item ${isCurrentQueueItem(queueItem) ? "active-item" : ""}" data-track-key="${escapeHtml(queueKey(queueItem))}">
            <div class="item-tools">
              ${source ? `<button class="tool-button" data-play-video="${index}" title="Play video">&#9654;</button>` : ""}
              ${source ? `<button class="tool-button" data-add-video="${index}" title="Add video">+</button>` : ""}
              ${source ? `<button class="tool-button" data-download-video="${index}" title="Download">&#8681;</button>` : ""}
              <a class="tool-button" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
            </div>
            <h3>${escapeHtml(item.title || "Video")}</h3>
            ${source?.label ? `<p class="muted">Best source: ${escapeHtml(source.label)}</p>` : ""}
            ${item.thumb ? `<img class="video-poster" src="${escapeHtml(item.thumb)}" loading="lazy" alt="">` : ""}
            ${source ? "" : `<p class="muted">No native video file found in metadata.</p>`}
          </div>
        `;
        })
        .join("")}
    </div>
  `;
  document.querySelectorAll("[data-download-video]").forEach((button) => {
    button.addEventListener("click", () => downloadProfileVideo(button));
  });
  document.querySelectorAll("[data-play-video]").forEach((button) => {
    button.addEventListener("click", () => playProfileVideo(Number(button.dataset.playVideo)));
  });
  document.querySelectorAll("[data-add-video]").forEach((button) => {
    button.addEventListener("click", () => {
      appendToPlaylist([profileVideoQueueItem(state.person.videos?.[Number(button.dataset.addVideo)])], { play: false });
      button.title = "Added video";
    });
  });
  $("[data-play-video-list]")?.addEventListener("click", () => {
    const queue = (state.person.videos || []).map(profileVideoQueueItem).filter((item) => item.mediaUrl);
    if (queue.length) replaceQueueAndPlay(queue, 0);
  });
}

function profileVideoQueueItem(item) {
  const source = bestVideoSource(item);
  return {
    kind: "video",
    mediaUrl: source?.url || "",
    title: item?.title || "Video",
    creator: state.person?.name || "",
    poster: item?.thumb || "",
  };
}

async function playProfileVideo(index) {
  const item = profileVideoQueueItem(state.person.videos?.[index]);
  if (!item.mediaUrl) return;
  const queue = (state.person.videos || []).map(profileVideoQueueItem).filter((row) => row.mediaUrl);
  const selectedIndex = queue.findIndex((row) => queueKey(row) === queueKey(item));
  const action = await chooseQueueAction({
    title: item.title,
    sourceLabel: "video list",
    sourceCount: queue.length,
  });
  if (action) await applyQueueChoice(action, queue, Math.max(0, selectedIndex));
}

async function downloadProfileVideo(button) {
  button.disabled = true;
  const originalTitle = button.title;
  button.title = "Downloading...";
  const index = Number(button.dataset.downloadVideo);
  const item = (state.person.videos || [])[index];
  try {
    const saved = await getCachedRecording(profileVideoQueueItem(item));
    button.title = `Saved ${saved.bytes} bytes`;
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

function bestVideoSource(item) {
  const sources = Array.isArray(item?.sources) ? item.sources : [];
  return sources[0] || (item?.mediaUrl ? { url: item.mediaUrl, label: "" } : null);
}

function renderPhotos() {
  $("#panel").innerHTML = `
    <div class="toolbar"><h2>Photos</h2><span class="muted">${(state.person.photos || []).length} photos</span></div>
    <div class="photo-grid">
      ${(state.person.photos || [])
        .map((photo, index) => {
          const full = typeof photo === "string" ? photo : photo.full;
          const thumb = typeof photo === "string" ? "" : photo.thumb;
          const preview = thumb || full;
          const title = (typeof photo === "string" ? photo.split("/").pop() : photo.title) || full.split("/").pop();
          return `
          <div class="item">
            <div class="item-tools">
              <button class="tool-button" data-photo-index="${index}" title="Download full image">&#8681;</button>
              <a class="tool-button" href="${escapeHtml(full)}" target="_blank" rel="noreferrer" title="Open source">&#8599;</a>
            </div>
            <h3>${escapeHtml(title)}</h3>
            ${preview ? `<img class="photo" src="${escapeHtml(preview)}" loading="lazy" alt="">` : `<p class="muted">Photo URL is stored as metadata.</p>`}
            <div data-photo-slot="${index}"></div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
  document.querySelectorAll("[data-photo-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const photo = (state.person.photos || [])[Number(button.dataset.photoIndex)];
      const full = typeof photo === "string" ? photo : photo?.full;
      if (full) downloadPhoto(button, full, `${state.person.id}/photos`, button.dataset.photoIndex);
    });
  });
}

async function downloadPhoto(button, url, subdir = `${state.person.id}/photos`, slotIndex = "") {
  button.disabled = true;
  const originalTitle = button.title;
  button.title = "Downloading...";
  try {
    const filename = url.split("/").pop();
    const saved = await api("/api/download", {
      method: "POST",
      body: JSON.stringify({ url, filename, subdir }),
    });
    const slot = document.querySelector(`[data-photo-slot="${CSS.escape(String(slotIndex))}"]`);
    if (slot && saved.publicPath) {
      slot.innerHTML = `<img class="photo" src="${saved.publicPath}" alt="">`;
    }
    button.title = "Saved";
  } catch (error) {
    alert(error.message);
    button.title = originalTitle;
  } finally {
    button.disabled = false;
  }
}

$("#home-button").addEventListener("click", renderHome);
$("#docs-button").addEventListener("click", () => {
  renderDocsHome(homeCategories());
});
window.addEventListener("scroll", syncSideHomeButtonVisibility, { passive: true });
$(".main")?.addEventListener("scroll", syncSideHomeButtonVisibility, { passive: true });
loadPeople().catch((error) => {
  $("#profile").innerHTML = "";
  $("#tabs").innerHTML = "";
  $("#panel").innerHTML = `<div class="empty"><h2>Could not load catalogue</h2><p>${error.message}</p></div>`;
});
