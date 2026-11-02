/* 遊戲清單：M Sea（原本的帳本）和之後加入的遊戲
 * 每個遊戲的資料、設定、統計、同步都各自獨立，互不影響。
 * 加新遊戲：寫一個模組呼叫 GCTGames.register({...})，再到 index.html 和 sw.js 加上檔案即可。
 *   id       唯一代號（也用在本機儲存和雲端路徑）
 *   name     顯示名稱；short 是手機上的短名
 *   prefix   網址前綴：#/<prefix>/<頁面>（M Sea 沒有前綴，沿用原本的 #/dashboard 等網址）
 *   home     切換到這個遊戲時預設打開的頁面
 *   nav      側欄／底部列的頁面清單 [{ id, label, short, icon, sub }]
 *   render(view, page, params, UI)、chrome(UI)、badge(pageId)、start(session)、onChange(fn)
 */
(function (global) {
  'use strict';

  const list = [];
  const Games = {
    register(game) {
      if (!game || !game.id || list.some((g) => g.id === game.id)) return;
      list.push(game);
    },
    list: () => list.slice(),
    get: (id) => list.find((g) => g.id === id) || null,
    // #/mm/idle → Maple M；其他網址（#/dashboard、#/entry…）都屬於 M Sea
    fromHash(hash) {
      const seg = String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
      return list.find((g) => g.prefix && g.prefix === seg) || Games.get('msea');
    },
    // 登入完成、資料載入前呼叫，讓每個遊戲載入自己的資料
    start(session) { list.forEach((g) => { if (g.start) g.start(session); }); },
  };

  // M Sea：原本的帳本（資料在 gct:data:v1，畫面在 app.js），這裡只登記名稱
  Games.register({ id: 'msea', name: 'M Sea', short: 'M Sea', prefix: '', home: '#/dashboard', builtin: true, desc: 'MapleStory SEA · CF Bal／Stock' });

  global.GCTGames = Games;
})(window);
