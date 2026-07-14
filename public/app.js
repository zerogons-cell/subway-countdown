const screens = {
  search: document.getElementById('screen-search'),
  lines: document.getElementById('screen-lines'),
  directions: document.getElementById('screen-directions'),
  countdown: document.getElementById('screen-countdown'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    stopCountdownLoop();
    showScreen(btn.dataset.back);
  });
});

// ---------- 즐겨찾기 ----------
const FAV_KEY = 'subway-countdown-favorites';

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

// 물리적 방향(상행/하행/내선/외선)을 키로 추적한다. 종착역(trainLineNm)은
// 열차마다 바뀔 수 있어(예: 중간에 회차하는 단축 운행) 즐겨찾기 키로 쓰면
// 다음 열차로 넘어갈 때 매칭이 끊겨 더 이상 갱신되지 않는 문제가 있었다.
function directionKey(subwayId, updnLine) {
  return `${subwayId || ''}_${updnLine || ''}`;
}

function isFavorite(station, subwayId, updnLine) {
  return getFavorites().some(
    (f) => f.station === station && directionKey(f.subwayId, f.updnLine) === directionKey(subwayId, updnLine)
  );
}

function toggleFavorite(station, subwayId, updnLine, label) {
  const favs = getFavorites();
  const idx = favs.findIndex(
    (f) => f.station === station && directionKey(f.subwayId, f.updnLine) === directionKey(subwayId, updnLine)
  );
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push({ station, subwayId, updnLine, label });
  }
  saveFavorites(favs);
  renderFavorites();
}

function renderFavorites() {
  const el = document.getElementById('favorites');
  const favs = getFavorites();
  el.innerHTML = '';
  favs.forEach((f) => {
    const chip = document.createElement('div');
    chip.className = 'fav-chip';
    chip.innerHTML = `
      <div class="fav-chip-info">
        <div class="fav-chip-station">${f.station}역</div>
        <div class="fav-chip-direction">${f.label || f.updnLine}</div>
      </div>
      <span class="fav-remove">✕</span>
    `;
    chip.querySelector('.fav-chip-info').addEventListener('click', () => {
      enterCountdown(f.station, f.subwayId, f.updnLine);
    });
    chip.querySelector('.fav-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(f.station, f.subwayId, f.updnLine);
    });
    el.appendChild(chip);
  });
}

// ---------- 검색 ----------
const searchForm = document.getElementById('search-form');
const stationInput = document.getElementById('station-input');
const searchError = document.getElementById('search-error');

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const station = stationInput.value.trim();
  if (!station) return;
  searchStation(station);
});

async function searchStation(station) {
  searchError.textContent = '';
  searchError.textContent = '검색 중...';
  try {
    const res = await fetch(`/api/arrivals?station=${encodeURIComponent(station)}`);
    const data = await res.json();
    if (data.error) {
      searchError.textContent = data.error;
      return;
    }
    if (!data.list || data.list.length === 0) {
      searchError.textContent = '도착 예정 정보가 없습니다. 역 이름을 확인해주세요.';
      return;
    }
    searchError.textContent = '';

    const lines = new Map();
    data.list.forEach((item) => {
      if (!lines.has(item.subwayId)) {
        lines.set(item.subwayId, { subwayId: item.subwayId, lineName: item.lineName });
      }
    });

    if (lines.size > 1) {
      renderLineSelection(station, data.list, [...lines.values()]);
    } else {
      renderDirections(station, data.list, 'search');
    }
  } catch (err) {
    console.error(err);
    searchError.textContent = '네트워크 오류가 발생했습니다.';
  }
}

// ---------- 호선 선택 (환승역) ----------
function renderLineSelection(station, list, lines) {
  document.getElementById('lines-station-name').textContent = `${station}역`;
  const listEl = document.getElementById('lines-list');
  listEl.innerHTML = '';

  lines
    .sort((a, b) => String(a.subwayId).localeCompare(String(b.subwayId)))
    .forEach((line) => {
      const card = document.createElement('div');
      card.className = 'direction-card';
      card.innerHTML = `<div class="line-name">${line.lineName}</div>`;
      card.addEventListener('click', () => {
        const filtered = list.filter((item) => item.subwayId === line.subwayId);
        renderDirections(station, filtered, 'lines');
      });
      listEl.appendChild(card);
    });

  showScreen('lines');
}

// ---------- 방향 선택 ----------
// 열차가 여러 정거장 앞에 있으면 API가 초 단위 대신
// "[4]번째 전역 (판교)" 같은 정거장 수 메시지만 주고 barvlDt는 0으로 온다.
// 이 경우 0초 도착으로 오인하지 않도록 별도로 구분한다.
const STATIONS_AWAY_RE = /번째\s*(전역|정거장)/;

function isReliableEta(item) {
  if (item.barvlDt > 0) return true;
  return !STATIONS_AWAY_RE.test(item.arvlMsg2 || '');
}

function stationsAwayCount(item) {
  const m = /\[(\d+)\]번째/.exec(item.arvlMsg2 || '');
  return m ? Number(m[1]) : 999;
}

// barvlDt는 "지금"이 아니라 recptnEpoch(서울시 시스템이 계산한 시각) 기준
// 남은 초다. 네트워크 지연, 무료 호스팅 콜드 스타트 등으로 그 사이 시간이
// 흐른 만큼 빼주지 않으면 카운트다운이 실제보다 항상 느리게(더 많이 남은
// 것처럼) 표시된다.
function correctedBarvlDt(item) {
  if (item.barvlDt <= 0 || !item.recptnEpoch) return item.barvlDt;
  const dataAgeSec = Math.max(0, Math.round((Date.now() - item.recptnEpoch) / 1000));
  return Math.max(item.barvlDt - dataAgeSec, 0);
}

function groupByDirection(list) {
  const groups = new Map();
  list.forEach((item) => {
    const key = directionKey(item.subwayId, item.updnLine || item.trainLineNm);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  groups.forEach((arr) => {
    arr.sort((a, b) => {
      const ra = isReliableEta(a);
      const rb = isReliableEta(b);
      if (ra && rb) return a.barvlDt - b.barvlDt;
      if (ra !== rb) return ra ? -1 : 1;
      return stationsAwayCount(a) - stationsAwayCount(b);
    });
  });
  return groups;
}

function formatEta(item) {
  if (!isReliableEta(item)) return item.arvlMsg2 || '정보 없음';
  const remaining = correctedBarvlDt(item);
  if (remaining <= 0) return item.arvlMsg2 || '곧 도착';
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function renderDirections(station, list, backTarget) {
  document.getElementById('directions-station-name').textContent = `${station}역`;
  const listEl = document.getElementById('directions-list');
  listEl.innerHTML = '';

  const backBtn = document.getElementById('directions-back-btn');
  backBtn.textContent = backTarget === 'lines' ? '← 호선 선택' : '← 다시 검색';
  backBtn.onclick = () => {
    stopCountdownLoop();
    showScreen(backTarget || 'search');
  };

  const groups = groupByDirection(list);
  groups.forEach((items) => {
    const soonest = items[0];
    const card = document.createElement('div');
    card.className = 'direction-card';
    card.innerHTML = `
      <div>
        <div class="line-name">${soonest.trainLineNm}</div>
        <div class="line-badge">${soonest.updnLine || ''} · ${soonest.lineName || ''}</div>
      </div>
      <div class="eta">${formatEta(soonest)}</div>
    `;
    card.addEventListener('click', () => {
      enterCountdown(station, soonest.subwayId, soonest.updnLine, soonest.trainLineNm);
    });
    listEl.appendChild(card);
  });

  showScreen('directions');
}

// ---------- 카운트다운 ----------
let countdownState = null;
let tickInterval = null;
let pollInterval = null;

function stopCountdownLoop() {
  if (tickInterval) clearInterval(tickInterval);
  if (pollInterval) clearInterval(pollInterval);
  tickInterval = null;
  pollInterval = null;
  countdownState = null;
}

async function enterCountdown(station, subwayId, updnLine, initialLabel) {
  stopCountdownLoop();
  document.getElementById('countdown-station').textContent = `${station}역`;
  document.getElementById('countdown-direction').textContent = initialLabel || updnLine || '';
  document.getElementById('countdown-error').textContent = '';
  document.getElementById('countdown-seconds').textContent = '';
  document.getElementById('countdown-status').textContent = '불러오는 중...';
  document.getElementById('next-train-info').textContent = '';

  const favBtn = document.getElementById('fav-toggle');
  const updateFavBtn = () => {
    favBtn.textContent = isFavorite(station, subwayId, updnLine) ? '★' : '☆';
  };
  updateFavBtn();
  favBtn.onclick = () => {
    toggleFavorite(station, subwayId, updnLine, countdownState && countdownState.trainLineNm);
    updateFavBtn();
  };

  showScreen('countdown');

  countdownState = { station, subwayId, updnLine };
  await refreshCountdown();
  pollInterval = setInterval(refreshCountdown, 15000);
  tickInterval = setInterval(tickCountdown, 1000);
}

async function refreshCountdown() {
  if (!countdownState) return;
  const { station, subwayId, updnLine } = countdownState;
  try {
    const res = await fetch(`/api/arrivals?station=${encodeURIComponent(station)}`);
    const data = await res.json();
    if (data.error) {
      document.getElementById('countdown-error').textContent = data.error;
      return;
    }
    const groups = groupByDirection(data.list);
    const items = groups.get(directionKey(subwayId, updnLine));
    if (!items || items.length === 0) {
      document.getElementById('countdown-error').textContent = '해당 방향의 도착 정보가 사라졌습니다. (운행 종료 시간대일 수 있어요)';
      return;
    }
    document.getElementById('countdown-error').textContent = '';
    const soonest = items[0];
    const next = items[1];

    countdownState.trainLineNm = soonest.trainLineNm;
    countdownState.tickable = isReliableEta(soonest);
    countdownState.remaining = correctedBarvlDt(soonest);
    countdownState.fetchedAt = Date.now();
    countdownState.arvlMsg2 = soonest.arvlMsg2;

    document.getElementById('countdown-direction').textContent = soonest.trainLineNm;
    document.getElementById('next-train-info').textContent = next
      ? `그 다음 열차: ${formatEta(next)} 후`
      : '';
  } catch (err) {
    console.error(err);
    document.getElementById('countdown-error').textContent = '네트워크 오류로 갱신하지 못했습니다.';
  }
}

function tickCountdown() {
  if (!countdownState || countdownState.remaining == null) return;
  const secondsEl = document.getElementById('countdown-seconds');
  const statusEl = document.getElementById('countdown-status');

  if (!countdownState.tickable) {
    secondsEl.textContent = '';
    secondsEl.classList.remove('warn', 'danger');
    statusEl.textContent = `${countdownState.arvlMsg2 || '정보 없음'} (초 단위 정보는 열차가 가까워지면 표시돼요)`;
    return;
  }

  const elapsed = Math.floor((Date.now() - countdownState.fetchedAt) / 1000);
  const remaining = Math.max(countdownState.remaining - elapsed, 0);

  secondsEl.textContent = remaining;
  secondsEl.classList.remove('warn', 'danger');
  if (remaining <= 10) {
    secondsEl.classList.add('danger');
    if (remaining > 0 && navigator.vibrate) navigator.vibrate(80);
  } else if (remaining <= 30) {
    secondsEl.classList.add('warn');
  }

  if (remaining <= 0) {
    statusEl.textContent = countdownState.arvlMsg2 || '곧 도착';
  } else {
    statusEl.textContent = '도착까지 남은 시간';
  }
}

// ---------- 초기화 ----------
renderFavorites();
