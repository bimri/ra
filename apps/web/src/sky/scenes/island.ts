// @ts-nocheck: the Ra design canvas's own scene code (App UI v2, E4 Island and G4 Landfall: the island as contour lines), copied verbatim from the board.
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function island(T, r, O, c) {
  return (function (T, r, O) {
  var sc = new T.Scene(), cam = new T.PerspectiveCamera(26, 1, 0.1, 80), root = new T.Group(); sc.add(root);
  var L = 15, N = 220, geos = [], mats = [], i, k;
  function shape(a) { return 1 + 0.22 * Math.sin(2 * a + 0.5) + 0.12 * Math.sin(3 * a + 2.0) + 0.06 * Math.sin(7 * a + 1.0) + 0.03 * Math.sin(11 * a + 0.3); }
  var top = null;
  for (i = 0; i < L; i++) {
    var e = i / L, rad = Math.pow(1 - e, 0.72), y = Math.pow(e, 0.85) * 0.78, cx = 0.22 * e, cz = -0.12 * e, pts = [];
    for (k = 0; k < N; k++) { var a = k / N * Math.PI * 2, q = rad * shape(a + e * 0.6) * (1 + 0.05 * Math.sin(5 * a + i)); pts.push(new T.Vector3(cx + Math.cos(a) * q, y, cz + Math.sin(a) * q)); }
    var last = i === L - 1, g = new T.TubeGeometry(new T.CatmullRomCurve3(pts, true), N, last ? 0.009 : 0.0045, 5, true);
    var m = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: last ? 1 : 0.28 + e * 0.6, depthWrite: false });
    m.userData.top = last; root.add(new T.Mesh(g, m)); geos.push(g); mats.push(m);
    if (last) top = new T.Vector3(cx, y, cz);
  }
  var pole = new T.CylinderGeometry(0.006, 0.006, 0.42, 6), pm = new T.MeshBasicMaterial({ color: 0xffffff }), pmesh = new T.Mesh(pole, pm);
  pmesh.position.set(top.x, top.y + 0.21, top.z); root.add(pmesh);
  var fgeo = new T.PlaneGeometry(0.2, 0.12, 8, 1), fm = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }), flag = new T.Mesh(fgeo, fm);
  flag.position.set(top.x + 0.1, top.y + 0.36, top.z); root.add(flag);
  var fp = fgeo.attributes.position, fx = []; for (k = 0; k < fp.count; k++) fx.push(fp.getX(k));
  var ripples = [], rg = new T.RingGeometry(1, 1.006, 160);
  for (i = 0; i < 4; i++) { var rm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }); var rmsh = new T.Mesh(rg, rm); rmsh.rotation.x = -Math.PI / 2; rmsh.position.set(0.05, -0.002, -0.02); root.add(rmsh); ripples.push(rmsh); mats.push(rm); }
  var dl = []; for (i = 0; i < 16; i++) { var rr = 1.3 + i * 0.16, cnt = Math.round(Math.PI * 2 * rr / 0.06); for (k = 0; k < cnt; k++) { var aa = k / cnt * Math.PI * 2 + i * 0.13; dl.push(Math.cos(aa) * rr * 1.08, 0, Math.sin(aa) * rr); } } var dn = dl.length / 3, dp = new Float32Array(dl);
  var dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(dp, 3));
  var dm = new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.35, depthWrite: false });
  root.add(new T.Points(dg, dm));
  return {
    size: function (w, h) { cam.aspect = w / h; cam.updateProjectionMatrix(); dm.size = 1.6 * r.getPixelRatio(); },
    frame: function (t, c) {
      var ink = c.text || '#F2F1EE', hi = c.hl || c.sig || '#FF5A1F';
      mats.forEach(function (m) { m.color.set(m.userData.top ? hi : ink); });
      pm.color.set(ink); fm.color.set(hi); dm.color.set(ink);
      for (var j = 0; j < fp.count; j++) { var x = fx[j] + 0.1; fp.setZ(j, Math.sin(x * 22 - t * 5) * 0.018 * (x / 0.2)); } fp.needsUpdate = true;
      ripples.forEach(function (m, j) { var p = ((t / 7) + j / 4) % 1; m.scale.setScalar(1.15 + p * 2.2); m.material.opacity = 0.45 * Math.sin(p * Math.PI) * (1 - p); });
      var az = t * 0.12 + 0.4, el = (O.el || 30) * Math.PI / 180, D = O.dist || 6.4;
      cam.position.set(D * Math.cos(el) * Math.sin(az), D * Math.sin(el) + 0.2, D * Math.cos(el) * Math.cos(az));
      cam.lookAt(0.05, 0.28, -0.03);
      r.render(sc, cam);
    },
    dispose: function () { geos.forEach(function (x) { x.dispose(); }); mats.forEach(function (x) { x.dispose(); }); pole.dispose(); pm.dispose(); fgeo.dispose(); fm.dispose(); rg.dispose(); dg.dispose(); dm.dispose(); }
  };
})(T, r, O, c);
}
