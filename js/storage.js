/* Banco Ladder — proyectos guardados en el navegador y archivos .ladder */
(function (root) {
  'use strict';
  const KEY = 'banco-ladder:projects';
  const CUR = 'banco-ladder:current';

  function readAll() {
    try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
  }
  function writeAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const Storage = {
    available() {
      try { localStorage.setItem('banco-ladder:probe', '1'); localStorage.removeItem('banco-ladder:probe'); return true; }
      catch (e) { return false; }
    },
    list() {
      return Object.values(readAll()).sort((a, b) => b.updated - a.updated);
    },
    get(id) { return readAll()[id] || null; },
    create(name, code) {
      const all = readAll();
      const p = { id: uid(), name: name || 'Proyecto sin nombre', code: code || '', created: Date.now(), updated: Date.now() };
      all[p.id] = p; writeAll(all); this.setCurrent(p.id);
      return p;
    },
    save(id, fields) {
      const all = readAll();
      if (!all[id]) return null;
      Object.assign(all[id], fields, { updated: Date.now() });
      return writeAll(all) ? all[id] : null;
    },
    remove(id) {
      const all = readAll(); delete all[id]; writeAll(all);
      if (this.currentId() === id) { try { localStorage.removeItem(CUR); } catch (e) {} }
    },
    duplicate(id) {
      const p = this.get(id); if (!p) return null;
      return this.create(p.name + ' (copia)', p.code);
    },
    currentId() { try { return localStorage.getItem(CUR); } catch (e) { return null; } },
    setCurrent(id) { try { localStorage.setItem(CUR, id); } catch (e) {} },

    // Formato de archivo .ladder (JSON)
    toFile(p) {
      return JSON.stringify({ format: 'banco-ladder', version: 1, name: p.name, savedAt: new Date().toISOString(), code: p.code }, null, 2);
    },
    fromFile(text, filename) {
      const base = (filename || 'Proyecto importado').replace(/\.(ladder|json|txt)$/i, '');
      try {
        const o = JSON.parse(text);
        if (o && o.format === 'banco-ladder' && typeof o.code === 'string') return { name: o.name || base, code: o.code };
      } catch (e) { /* no es JSON: se toma como código */ }
      if (typeof text === 'string' && text.length < 500000) return { name: base, code: text };
      throw new Error('El archivo no es un proyecto de Banco Ladder.');
    }
  };
  root.LadderStorage = Storage;
})(window);
