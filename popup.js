// 弹窗 UI：从 storage 读取状态并本地每秒刷新倒计时

let state = null;

const $ = (id) => document.getElementById(id);
const app = $('app');
const timeEl = $('time');
const startPauseBtn = $('startPause');

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function remainingMs() {
  return state.running ? state.endTime - Date.now() : state.remaining;
}

function render() {
  if (!state) return;
  app.dataset.phase = state.phase;
  timeEl.textContent = fmt(remainingMs());

  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.phase === state.phase));

  startPauseBtn.textContent = state.running ? '暂停' : '开始';

  // 番茄钟进度圆点（每 longEvery 一组）
  const dots = $('dots');
  dots.innerHTML = '';
  const inCycle = state.done % state.settings.longEvery;
  for (let i = 0; i < state.settings.longEvery; i++) {
    const d = document.createElement('span');
    d.className = 'dot' + (i < inCycle ? ' filled' : '');
    dots.appendChild(d);
  }

  document.title = `${fmt(remainingMs())} 番茄时钟`;
}

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

startPauseBtn.addEventListener('click', () => send(state.running ? 'pause' : 'start'));
$('reset').addEventListener('click', () => send('reset'));
$('skip').addEventListener('click', () => send('skip'));

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => send('setPhase', { phase: t.dataset.phase })));

$('saveSettings').addEventListener('click', () => {
  send('settings', {
    settings: {
      work: clamp($('setWork').value, 1, 120, 25),
      short: clamp($('setShort').value, 1, 60, 5),
      long: clamp($('setLong').value, 1, 120, 15),
      longEvery: clamp($('setEvery').value, 2, 12, 4),
      autoStart: $('setAuto').checked,
    },
  });
});

function clamp(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function fillSettings() {
  $('setWork').value = state.settings.work;
  $('setShort').value = state.settings.short;
  $('setLong').value = state.settings.long;
  $('setEvery').value = state.settings.longEvery;
  $('setAuto').checked = state.settings.autoStart;
}

async function load() {
  const s = await chrome.storage.local.get(['phase', 'running', 'endTime', 'remaining', 'done', 'settings']);
  state = {
    phase: s.phase || 'work',
    running: !!s.running,
    endTime: s.endTime || 0,
    remaining: s.remaining ?? 25 * 60 * 1000,
    done: s.done || 0,
    settings: { work: 25, short: 5, long: 15, longEvery: 4, autoStart: true, ...(s.settings || {}) },
  };
  fillSettings();
  render();
}

// 后台状态变化时同步（开始/暂停/阶段切换）
chrome.storage.onChanged.addListener(() => load());

load();
// 弹窗打开期间本地每 250ms 刷新显示（不依赖后台）
setInterval(render, 250);
