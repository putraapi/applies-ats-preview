/*
 * dc-lite: a minimal runtime that renders the design-canvas screen format
 * (<template id="dc"> + `class Component extends DCLogic`) as a standalone page.
 * Supports {{holes}}, <sc-for>, <sc-if>, on* handlers, state/setState.
 * Table/select tags arrive prefixed with "x-" so the HTML parser does not
 * move <sc-for> out of them; they are created as the real elements here.
 */
(function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var RENAMED = { 'x-table': 'table', 'x-thead': 'thead', 'x-tbody': 'tbody', 'x-tr': 'tr', 'x-th': 'th', 'x-td': 'td', 'x-select': 'select', 'x-option': 'option' };
  var PROPS = { checked: 'checked', disabled: 'disabled', readonly: 'readOnly', selected: 'selected', defaultchecked: 'checked', defaultvalue: 'value', value: 'value' };

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) v = v == null ? undefined : v[parts[i]];
    return v;
  }
  function str(v) { return v == null || v === false ? '' : String(v); }
  function evalAttr(raw, scope) {
    var m = raw.match(WHOLE);
    if (m) return lookup(m[1], scope);
    return raw.replace(HOLE, function (_, e) { return str(lookup(e, scope)); });
  }

  function renderNodes(parent, nodes, scope) {
    for (var i = 0; i < nodes.length; i++) renderNode(parent, nodes[i], scope);
  }

  function renderNode(parent, node, scope) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      parent.appendChild(document.createTextNode(t.indexOf('{{') < 0 ? t : t.replace(HOLE, function (_, e) { return str(lookup(e, scope)); })));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = evalAttr(node.getAttribute('list') || '', scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope);
        s[as] = list[i];
        s.$index = i;
        renderNodes(parent, node.childNodes, s);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (evalAttr(node.getAttribute('value') || '', scope)) renderNodes(parent, node.childNodes, scope);
      return;
    }

    var el = node.namespaceURI === SVG ? document.createElementNS(SVG, tag) : document.createElement(RENAMED[tag] || tag);
    var deferredValue;
    for (var a = 0; a < node.attributes.length; a++) {
      var name = node.attributes[a].name, raw = node.attributes[a].value;
      var lname = name.toLowerCase();
      if (lname.indexOf('hint-') === 0) continue;
      var v = raw.indexOf('{{') < 0 ? raw : evalAttr(raw, scope);
      if (lname.indexOf('on') === 0 && lname.length > 2) {
        if (typeof v === 'function') el.addEventListener(lname.slice(2), v);
        continue;
      }
      if (PROPS[lname] && el.namespaceURI !== SVG) {
        var prop = PROPS[lname];
        if (prop === 'value' && el.localName === 'select') { deferredValue = v; continue; }
        if (prop === 'value') el.value = str(v);
        else el[prop] = v === true || v === '' || v === 'true' || v === prop || v === lname;
        continue;
      }
      if (v === false || v == null) continue;
      el.setAttribute(name, v === true ? '' : String(v));
    }
    renderNodes(el, node.childNodes, scope);
    if (deferredValue !== undefined) el.value = str(deferredValue);
    parent.appendChild(el);
  }

  // Keep focus and scroll positions across full re-renders.
  function pathOf(el, root) {
    var p = [];
    while (el && el !== root) { p.unshift(Array.prototype.indexOf.call(el.parentNode.children, el)); el = el.parentNode; }
    return el === root ? p : null;
  }
  function atPath(root, p) {
    var el = root;
    for (var i = 0; el && i < p.length; i++) el = el.children[p[i]];
    return el;
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u) {
    var patch = typeof u === 'function' ? u(this.state, this.props) : u;
    this.state = Object.assign({}, this.state, patch);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };

  var tpl, root, inst, queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; render(); });
  }
  function render() {
    var active = document.activeElement;
    var focusPath = active && root.contains(active) ? pathOf(active, root) : null;
    var sel = null;
    try { if (focusPath && typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd]; } catch (e) {}
    var scrolls = [];
    root.querySelectorAll('*').forEach(function (el) {
      if (el.scrollLeft || el.scrollTop) scrolls.push([pathOf(el, root), el.scrollLeft, el.scrollTop]);
    });
    var frag = document.createDocumentFragment();
    renderNodes(frag, tpl.content.childNodes, inst.renderVals() || {});
    root.replaceChildren(frag);
    scrolls.forEach(function (s) { var el = atPath(root, s[0]); if (el) { el.scrollLeft = s[1]; el.scrollTop = s[2]; } });
    if (focusPath) {
      var f = atPath(root, focusPath);
      if (f && f.focus) {
        f.focus({ preventScroll: true });
        if (sel) { try { f.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
      }
    }
    var app = root.firstElementChild;
    if (app) document.documentElement.style.background = getComputedStyle(app).backgroundColor;
  }

  function boot() {
    tpl = document.getElementById('dc');
    root = document.getElementById('dc-root');
    var logic = document.getElementById('dc-logic');
    var props = {};
    try {
      var decl = JSON.parse(logic.getAttribute('data-props') || '{}');
      Object.keys(decl).forEach(function (k) { if (k[0] !== '$' && 'default' in decl[k]) props[k] = decl[k].default; });
    } catch (e) {}
    var Component = new Function('DCLogic', logic.textContent + '\n;return Component;')(DCLogic);
    inst = new Component(props);
    if (!inst.props) inst.props = props;
    render();
    if (inst.componentDidMount) inst.componentDidMount();
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { schedule(); });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
