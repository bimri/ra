// @ts-nocheck: the Ra design canvas's own scene code (App UI v2, U5 Rings), ported as is,
// except that each month's width (O.widths) comes from your Rays instead of the canvas's sample year.
// The ring vessel: a year of rings, one band per Ray.
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function rings(T, r, O, c) {
  return (function (T, r, O) {
  var sc = new T.Scene(), cam = new T.PerspectiveCamera(20, 1, 0.1, 80), root = new T.Group(); sc.add(root);
  var M = O.widths || [.6, .8, .7, .22, .35, .75, 1, .6, .5, .7, .55, .8], n = O.n || 12, N = 200, dz = O.dz || 0.07, H = (n - 1) * dz;
  var ph = [0.6, 2.1, 4.0], radii = [], R = 0.12, i, k;
  for (i = 0; i < n; i++) { R += 0.04 + M[i % 12] * 0.085; radii.push(R); }
  var S = 1 / radii[n - 1], geos = [], mats = [], rings = [];
  function rr(q, a, j) { return q * (1 + 0.034 * Math.sin(3 * a + ph[0]) + 0.021 * Math.sin(5 * a + ph[1] + j * 0.17) + 0.011 * Math.sin(9 * a + ph[2] + j * 0.41)); }
  for (i = 0; i < n; i++) {
    var pts = [], e = 1 - i / n, cx = 0.08 * e, cz = -0.05 * e;
    for (k = 0; k < N; k++) { var a = k / N * Math.PI * 2, q = rr(radii[i] * S, a, i); pts.push(new T.Vector3(cx + Math.cos(a) * q, i * dz - H / 2, cz + Math.sin(a) * q)); }
    var land = i === O.land, curve = new T.CatmullRomCurve3(pts, true);
    var gg = new T.TubeGeometry(curve, N, land ? 0.012 : 0.0048, 6, true);
    var mm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: land ? 1 : 0.3 + M[i % 12] * 0.5, depthWrite: false });
    mm.userData.land = land; root.add(new T.Mesh(gg, mm)); geos.push(gg); mats.push(mm); rings.push(pts);
    if (land) { var hg = new T.TubeGeometry(curve, N, 0.04, 8, true), hm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }); hm.userData.land = true; hm.userData.halo = true; root.add(new T.Mesh(hg, hm)); geos.push(hg); mats.push(hm); }
  }
  var sv = [];
  for (var s = 0; s < 48; s++) { k = Math.floor(s / 48 * N); for (i = 0; i < n - 1; i++) sv.push(rings[i][k], rings[i + 1][k]); }
  var sg = new T.BufferGeometry().setFromPoints(sv), sm = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
  root.add(new T.LineSegments(sg, sm));
  var pg = new T.SphereGeometry(0.028, 16, 12), pm = new T.MeshBasicMaterial({ color: 0xffffff }), pith = new T.Mesh(pg, pm);
  pith.position.set(0.08, -H / 2, -0.05); root.add(pith);
  var W = 1, Hh = 1;
  function sm1(a, b, x) { x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  return {
    size: function (w, h) { W = w; Hh = h; cam.aspect = w / h; cam.updateProjectionMatrix(); },
    frame: function (t, c) {
      for (var j = 0; j < mats.length; j++) mats[j].color.set(mats[j].userData.land ? (c.sig || '#FF5A1F') : (c.text || '#0C0C0C'));
      sm.color.set(c.text || '#0C0C0C'); pm.color.set(c.sig || '#FF5A1F');
      var cyc = (t % 18) / 18, tilt = sm1(0.22, 0.42, cyc) - sm1(0.78, 0.96, cyc);
      var el = (89.4 - tilt * 54) * Math.PI / 180, az = t * 0.16 + 0.6, D = O.dist || 7.2;
      cam.position.set(D * Math.cos(el) * Math.sin(az), D * Math.sin(el), D * Math.cos(el) * Math.cos(az));
      cam.lookAt(0, 0, 0);
      r.render(sc, cam);
    },
    dispose: function () { geos.forEach(function (x) { x.dispose(); }); mats.forEach(function (x) { x.dispose(); }); sg.dispose(); sm.dispose(); pg.dispose(); pm.dispose(); }
  };
})(T, r, O, c);
}
