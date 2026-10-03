// 番茄时钟后台 Service Worker
// 使用 chrome.alarms 保证 Service Worker 休眠后仍能准时触发

const DEFAULTS = { work: 25, short: 5, long: 15, longEvery: 4, autoStart: true };

const PHASE_LABEL = { work: '专注', short: '短休息', long: '长休息' };
const BADGE_COLOR = { work: '#e74c3c', short: '#27ae60', long: '#2980b9' };

function durationOf(phase, settings) {
  return settings[phase] * 60 * 1000;
}

async function getState() {
  const s = await chrome.storage.local.get(['phase', 'running', 'endTime', 'remaining', 'done', 'settings']);
  const settings = { ...DEFAULTS, ...(s.settings || {}) };
  const phase = s.phase || 'work';
  return {
    phase,
    running: !!s.running,
    endTime: s.endTime || 0,
    remaining: s.remaining ?? durationOf(phase, settings),
    done: s.done || 0,
    settings,
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
  const st = await getState();
  updateBadge(st);
}

function updateBadge(st) {
  if (st.running) {
    const ms = Math.max(0, st.endTime - Date.now());
    chrome.action.setBadgeText({ text: ms > 0 ? String(Math.ceil(ms / 60000)) : '0' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR[st.phase] });
}

function scheduleEnd(endTime) {
  chrome.alarms.create('phaseEnd', { when: endTime });
  // 每分钟刷新一次角标（Service Worker 无法可靠使用 setInterval）
  chrome.alarms.create('badgeRefresh', { periodInMinutes: 1 });
}

function clearAlarms() {
  chrome.alarms.clear('phaseEnd');
  chrome.alarms.clear('badgeRefresh');
}

async function startTimer() {
  const st = await getState();
  const endTime = Date.now() + st.remaining;
  await setState({ running: true, endTime });
  scheduleEnd(endTime);
}

async function pauseTimer() {
  const st = await getState();
  if (!st.running) return;
  clearAlarms();
  await setState({ running: false, remaining: Math.max(0, st.endTime - Date.now()) });
}

async function resetTimer() {
  const st = await getState();
  clearAlarms();
  await setState({
    running: false,
    remaining: durationOf(st.phase, st.settings),
  });
}

async function finishPhase(notify) {
  const st = await getState();
  clearAlarms();

  let { phase, done } = st;
  if (phase === 'work') {
    done += 1;
    phase = done % st.settings.longEvery === 0 ? 'long' : 'short';
  } else {
    phase = 'work';
  }

  if (notify) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/png;base64,',
      title: '番茄时钟',
      message: phase === 'work'
        ? `休息结束，开始第 ${Math.floor(done / st.settings.longEvery) * st.settings.longEvery + (done % st.settings.longEvery) + 1} 个番茄钟吧！`
        : `第 ${done} 个番茄钟完成！进入${PHASE_LABEL[phase]}。`,
      priority: 2,
    }).catch(() => {});
  }

  const remaining = durationOf(phase, st.settings);
  if (st.settings.autoStart) {
    const endTime = Date.now() + remaining;
    await setState({ phase, done, running: true, remaining, endTime });
    scheduleEnd(endTime);
  } else {
    await setState({ phase, done, running: false, remaining });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'phaseEnd') {
    await finishPhase(true);
  } else if (alarm.name === 'badgeRefresh') {
    updateBadge(await getState());
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'start': await startTimer(); break;
      case 'pause': await pauseTimer(); break;
      case 'reset': await resetTimer(); break;
      case 'skip': await finishPhase(false); break;
      case 'setPhase': {
        const st = await getState();
        clearAlarms();
        await setState({
          phase: msg.phase,
          running: false,
          remaining: durationOf(msg.phase, st.settings),
        });
        break;
      }
      case 'settings': {
        const st = await getState();
        const settings = { ...st.settings, ...msg.settings };
        const patch = { settings };
        if (!st.running) patch.remaining = durationOf(st.phase, settings);
        await setState(patch);
        break;
      }
    }
    sendResponse(await getState());
  })();
  return true; // 异步响应
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get('settings');
  if (!s.settings) await chrome.storage.local.set({ settings: DEFAULTS });
  updateBadge(await getState());
});
