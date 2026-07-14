const screens = {
  search: document.getElementById('screen-search'),
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

function isFavorite(station, trainLineNm) {
  return getFavorites().some((f) => f.station === station && f.trainLineNm === trainLineNm);
}

function toggleFavorite(station, trainLineNm, updnLine) {
  const favs = getFavorites();
  const idx = favs.findIndex((f) => f.station === station && f.trainLineNm === trainLineNm);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push({ station, trainLineNm, updnLine });
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
    chip.innerHTML = `<span>${f.station} · ${f.trainLineNm}</span><span class="fav-remove">✕</span>`;
    chip.querySelector('span:first-child').addEventListener('click', () => {
      enterCountdown(f.station, f.trainLineNm, f.updnLine);
    });
    chip.querySelector('.fav-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(f.station, f.trainLineNm, f.updnLine);
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
    renderDirections(station, data.list);
  } catch (err) {
    console.error(err);
    searchError.textContent = '네트워크 오류가 발생했습니다.';
  }
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

function groupByDirection(list) {
  const groups = new Map();
  list.forEach((item) => {
    const key = item.trainLineNm;
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
  if (item.barvlDt <= 0) return item.arvlMsg2 || '곧 도착';
  const m = Math.floor(item.barvlDt / 60);
  const s = item.barvlDt % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function renderDirections(station, list) {
  document.getElementById('directions-station-name').textContent = `${station}역`;
  const listEl = document.getElementById('directions-list');
  listEl.innerHTML = '';

  const groups = groupByDirection(list);
  groups.forEach((items, trainLineNm) => {
    const soonest = items[0];
    const card = document.createElement('div');
    card.className = 'direction-card';
    card.innerHTML = `
      <div>
        <div class="line-name">${trainLineNm}</div>
        <div class="updn">${soonest.updnLine || ''} · ${soonest.subwayNm || ''}</div>
      </div>
      <div class="eta">${formatEta(soonest)}</div>
    `;
    card.addEventListener('click', () => {
      enterCountdown(station, trainLineNm, soonest.updnLine);
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

async function enterCountdown(station, trainLineNm, updnLine) {
  stopCountdownLoop();
  document.getElementById('countdown-station').textContent = `${station}역`;
  document.getElementById('countdown-direction').textContent = trainLineNm;
  document.getElementById('countdown-error').textContent = '';
  document.getElementById('countdown-seconds').textContent = '';
  document.getElementById('countdown-status').textContent = '불러오는 중...';
  document.getElementById('next-train-info').textContent = '';

  const favBtn = document.getElementById('fav-toggle');
  const updateFavBtn = () => {
    favBtn.textContent = isFavorite(station, trainLineNm) ? '★' : '☆';
  };
  updateFavBtn();
  favBtn.onclick = () => {
    toggleFavorite(station, trainLineNm, updnLine);
    updateFavBtn();
  };

  showScreen('countdown');

  countdownState = { station, trainLineNm };
  await refreshCountdown();
  pollInterval = setInterval(refreshCountdown, 15000);
  tickInterval = setInterval(tickCountdown, 1000);
}

async function refreshCountdown() {
  if (!countdownState) return;
  const { station, trainLineNm } = countdownState;
  try {
    const res = await fetch(`/api/arrivals?station=${encodeURIComponent(station)}`);
    const data = await res.json();
    if (data.error) {
      document.getElementById('countdown-error').textContent = data.error;
      return;
    }
    const groups = groupByDirection(data.list);
    const items = groups.get(trainLineNm);
    if (!items || items.length === 0) {
      document.getElementById('countdown-error').textContent = '해당 방향의 도착 정보가 사라졌습니다. (열차 통과 직후일 수 있어요)';
      return;
    }
    document.getElementById('countdown-error').textContent = '';
    const soonest = items[0];
    const next = items[1];

    countdownState.tickable = isReliableEta(soonest);
    countdownState.remaining = soonest.barvlDt;
    countdownState.fetchedAt = Date.now();
    countdownState.arvlMsg2 = soonest.arvlMsg2;

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
