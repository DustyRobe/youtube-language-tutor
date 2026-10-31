// IndexedDB 封装（Service Worker 内可用）
// 库: vl-lessons；仓: lessons（keyPath: videoKey）

const DB_NAME = 'vl-lessons';
const DB_VERSION = 1;
const STORE = 'lessons';

export { dbGetLesson, dbSaveLesson, dbListLessons, dbDeleteLesson };

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('字幕缓存数据库打开超时')), 2000);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'videoKey' });
      }
    };
    req.onsuccess = () => {
      if (settled) { req.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onblocked = () => fail(new Error('字幕缓存数据库被其他页面阻塞'));
    req.onerror = () => fail(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(STORE, mode); }
    catch (error) { db.close(); reject(error); return; }
    const timer = setTimeout(() => {
      try { tx.abort(); } catch {}
      db.close();
      reject(new Error('字幕缓存数据库事务超时'));
    }, 2000);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      clearTimeout(timer);
      try { tx.abort(); } catch {}
      db.close();
      reject(e);
      return;
    }
    tx.oncomplete = () => {
      clearTimeout(timer);
      db.close();
      resolve(result instanceof IDBRequest ? result.result : result);
    };
    tx.onerror = tx.onabort = () => {
      clearTimeout(timer);
      db.close();
      reject(tx.error || new Error('字幕缓存事务已中止'));
    };
  });
}

/** lesson 结构:
 * { videoKey, cues: [{start,end,text}], lessons: {"<cueIndex>": {words,culture,grammar}}, meta: {source, createdAt, title} }
 */
async function dbGetLesson(videoKey) {
  const req = await withStore('readonly', (store) => store.get(videoKey));
  return req || null;
}

async function dbSaveLesson(lesson) {
  await withStore('readwrite', (store) => store.put(lesson));
  return true;
}

async function dbDeleteLesson(videoKey) {
  await withStore('readwrite', (store) => store.delete(videoKey));
  return true;
}

async function dbListLessons() {
  const req = await withStore('readonly', (store) => store.getAll());
  return (req || []).map((l) => ({
    videoKey: l.videoKey,
    title: l.meta?.title || l.videoKey,
    cueCount: (l.cues || []).length,
    lessonCount: Object.keys(l.lessons || {}).length,
    createdAt: l.meta?.createdAt || 0,
  }));
}
