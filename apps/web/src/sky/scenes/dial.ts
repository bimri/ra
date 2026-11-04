// @ts-nocheck: the Ra design canvas's own scene code (App UI v2, E6 / E7 Dial), ported as is,
// except that the first year (O.start) and Ra's range (O.from, O.to) come from your call, not 2026 and 2027–2030.
// A stone calendar circle in the manner of Nabta Playa: slabs ring a dial of years; the standing stone's shadow falls on your call; Ra's range glows along the rim.
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function dial(T, r, O, c) {
  return (function (T, r, O) {
  var sc = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 60), geos = [], mats = [], i;
  r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
  var hemi = new T.HemisphereLight(0xffffff, 0xcfc6b4, 0.6); sc.add(hemi);
  var sun = new T.DirectionalLight(0xfff6ea, 0.85); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.radius = 3;
  var scam = sun.shadow.camera; scam.left = -2.6; scam.right = 2.6; scam.top = 2.6; scam.bottom = -2.6; scam.near = 0.5; scam.far = 16;
  sc.add(sun); sc.add(sun.target);
  var cols = { sand: new T.Color(), stone: new T.Color(), dial: new T.Color(), cut: new T.Color(), sig: new T.Color() };
  function std(role, rough) { var m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: rough === undefined ? 0.94 : rough, metalness: 0 }); m.userData.role = role; mats.push(m); return m; }
  function mesh(g, m, cast, recv) { var x = new T.Mesh(g, m); x.castShadow = !!cast; x.receiveShadow = !!recv; geos.push(g); sc.add(x); return x; }
  // the sand, fading into the page at its edge
  var cv = document.createElement('canvas'); cv.width = cv.height = 256; var cx2 = cv.getContext('2d'), grd = cx2.createRadialGradient(128, 128, 20, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.62, '#fff'); grd.addColorStop(1, '#000'); cx2.fillStyle = grd; cx2.fillRect(0, 0, 256, 256);
  var atex = new T.CanvasTexture(cv), sandM = std('sand', 1); sandM.transparent = true; sandM.alphaMap = atex; sandM.depthWrite = false;
  var ground = mesh(new T.CircleGeometry(4.4, 96), sandM, false, true); ground.rotation.x = -Math.PI / 2;
  // the dial: a carved disc with two engraved rings
  mesh(new T.CylinderGeometry(1.0, 1.05, 0.07, 96), std('dial', 0.88), true, true).position.y = 0.035;
  [0.94, 0.66].forEach(function (rr) { var t2 = mesh(new T.TorusGeometry(rr, 0.0045, 4, 160), std('cut', 1), false, false); t2.rotation.x = Math.PI / 2; t2.position.y = 0.071; });
  // years along the far half of the rim: 2026 on the left, 2032 on the right
  var Y0 = O.start || 2026, Y1 = Y0 + 6, th = function (y) { return Math.PI - (y - Y0) / (Y1 - Y0) * Math.PI; };
  for (i = 0; i <= 24; i++) {
    var y = Y0 + i / 4, a = th(y), major = i % 4 === 0, call = Math.abs(y - (O.call || 2028)) < 0.01;
    var tk = mesh(new T.BoxGeometry(major ? 0.014 : 0.008, 0.012, major ? 0.13 : 0.07), std(call ? 'sig' : 'cut', 1), false, false);
    var rr2 = major ? 0.86 : 0.885; tk.position.set(Math.cos(a) * rr2, 0.074, -Math.sin(a) * rr2); tk.rotation.y = a - Math.PI / 2;
  }
  // year labels, drawn into small textures
  var labels = [];
  for (var yr = Y0; yr <= Y1; yr++) {
    var c2 = document.createElement('canvas'); c2.width = 256; c2.height = 96; var tex = new T.CanvasTexture(c2);
    var spm = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }); mats.push(spm);
    var sp = new T.Sprite(spm), a4 = th(yr); sp.position.set(Math.cos(a4) * 0.6, 0.11, -Math.sin(a4) * 0.6); sp.scale.set(0.32, 0.12, 1); sc.add(sp);
    labels.push({ c: c2, t: tex, y: yr, drawn: '' });
  }
  // the standing stone at the centre
  var gn = mesh(new T.BoxGeometry(0.075, 0.56, 0.06), std('stone'), true, true); gn.position.set(0, 0.35, 0); gn.rotation.set(0.02, 0.3, -0.03);
  // the ring of upright slabs, open towards you
  for (i = 0; i < 22; i++) {
    var a5 = i / 22 * Math.PI * 2, z5 = Math.sin(a5) * 1.5; if (z5 > 0.95) continue;
    var h5 = 0.13 + ((i * 37) % 7) / 7 * 0.16, sl = mesh(new T.BoxGeometry(0.18, h5, 0.06), std('stone'), true, true);
    sl.position.set(Math.cos(a5) * 1.5, h5 / 2, z5); sl.rotation.set(((i * 13) % 5 - 2) * 0.03, -a5 + Math.PI / 2, ((i * 7) % 5 - 2) * 0.04);
  }
  // two tall gate stones framing the sightline
  [-0.2, 0.2].forEach(function (d) { var a6 = -Math.PI / 2 + d, gs = mesh(new T.BoxGeometry(0.2, 0.52, 0.08), std('stone'), true, true); gs.position.set(Math.cos(a6) * 1.78, 0.26, Math.sin(a6) * 1.78); gs.rotation.y = -a6 + Math.PI / 2; });
  // an alignment of megaliths running off into the distance
  for (i = 0; i < 6; i++) { var f6 = i / 5, ms = 0.26 - f6 * 0.14, mg = mesh(new T.BoxGeometry(ms * 0.8, ms, ms * 0.5), std('stone'), true, true); mg.position.set(1.1 + f6 * 1.5, ms / 2, -2.0 - f6 * 2.4); mg.rotation.y = 0.4 + i * 0.3; }
  // Ra's range, glowing along the rim
  if (O.range) {
    var rp = []; for (i = 0; i <= 60; i++) { var a7 = th((O.from || 2027) + i / 60 * ((O.to || 2030) - (O.from || 2027))); rp.push(new T.Vector3(Math.cos(a7) * 0.975, 0.076, -Math.sin(a7) * 0.975)); }
    var rc = new T.CatmullRomCurve3(rp), rgm = new T.TubeGeometry(rc, 60, 0.012, 6, false), rgm2 = new T.TubeGeometry(rc, 60, 0.034, 8, false);
    var rmat = new T.MeshBasicMaterial({ color: 0xffffff }); rmat.userData.role = 'sig'; var rmat2 = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }); rmat2.userData.role = 'sig';
    sc.add(new T.Mesh(rgm, rmat)); sc.add(new T.Mesh(rgm2, rmat2)); geos.push(rgm, rgm2); mats.push(rmat, rmat2);
  }
  // the sun stands opposite your call, so the shadow points at it
  var ac = th(O.call || 2028), el = Math.atan(0.62 / 0.78);
  function draw(L2, c, ink, sig) { var x = L2.c.getContext('2d'); x.clearRect(0, 0, 256, 96); var on = L2.y === (O.call || 2028); x.font = (on ? '700 ' : '500 ') + '56px "JetBrains Mono", ui-monospace, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = on ? sig : ink; x.globalAlpha = on ? 1 : 0.72; x.fillText(String(L2.y), 128, 50); L2.t.needsUpdate = true; L2.drawn = ink + sig; }
  return {
    size: function (w, h) { cam.aspect = w / h; cam.updateProjectionMatrix(); },
    frame: function (t, c) {
      var dark = !!c.dark;
      cols.sand.set(dark ? '#1C1B18' : '#CFCAC0'); cols.stone.set(dark ? '#4A463E' : '#9C9483'); cols.dial.set(dark ? '#2F2D28' : '#C9C2B4'); cols.cut.set(dark ? '#8E887B' : '#5F5747'); cols.sig.set(c.sig || '#FF5A1F');
      mats.forEach(function (m) { var ro = m.userData.role; if (ro && cols[ro]) m.color.copy(cols[ro]); });
      hemi.intensity = dark ? 0.5 : 0.55; hemi.groundColor.set(dark ? '#2A2722' : '#CFC6B4');
      var lab = dark ? '#D9D4C8' : '#3C3830', sig = c.sig || '#FF5A1F'; labels.forEach(function (L2) { if (L2.drawn !== lab + sig) draw(L2, c, lab, sig); });
      var a8 = ac + Math.PI + Math.sin(t * 0.25) * 0.03, D = 7;
      sun.position.set(Math.cos(a8) * Math.cos(el) * D, Math.sin(el) * D, -Math.sin(a8) * Math.cos(el) * D); sun.target.position.set(0, 0, 0);
      cam.position.set(Math.sin(t * 0.12) * 0.35, 3.2, 4.3); cam.lookAt(0, 0, -0.55);
      r.render(sc, cam);
    },
    dispose: function () { geos.forEach(function (x) { x.dispose(); }); mats.forEach(function (x) { x.dispose(); }); atex.dispose(); labels.forEach(function (L2) { L2.t.dispose(); }); }
  };
})(T, r, O, c);
}
