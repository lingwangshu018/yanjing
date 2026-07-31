(() => {
  'use strict';

  const KEY = 'jx_memory_calendar_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{"events":[],"cycles":[]}'); }
    catch { return { events: [], cycles: [] }; }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function addEvent(event) {
    const data = load();
    data.events.push({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...event
    });
    save(data);
    return data;
  }

  function finishPeriod(endDate = new Date().toISOString().slice(0, 10)) {
    const data = load();
    const active = [...data.cycles].reverse().find(x => x.status !== 'finished');
    if (active) {
      active.status = 'finished';
      active.actualEndDate = endDate;
      active.confirmedByUser = true;
    }
    save(data);
    return data;
  }

  window.MemoryCalendar = { load, save, addEvent, finishPeriod };
})();
