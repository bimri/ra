// @ts-nocheck: scene code in the canvas's shape (App UI v2, A3 Lock / J3 Locked).
// The lock as the boards draw it: nine broken hairline rings in the text
// colour, fainter towards the core, around a breathing signal core. Each
// ring only turns in its own plane (rotation.z), alternate ones the other
// way; one slight fixed tilt of the group gives depth. Unlit, so the rings
// stay ink-flat: lit metal tubes read as muddy copper on Paper (4 Nov).
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function lock(T, r, O, c) {
  var sc = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 0, 6.4);
  cam.lookAt(0, 0, 0);

  var group = new T.Group();
  group.rotation.set(-0.14, 0.12, 0);
  sc.add(group);

  // The flat board's rings (radius 14 to 86 of 220, 1.3 stroke) at this camera's scale.
  var rings = [], geos = [], mats = [], i;
  for (i = 0; i < 9; i++) {
    var rad = 0.19 + i * 0.118, gap = 0.32 + (i % 3) * 0.24;
    var g = new T.TorusGeometry(rad, 0.0085, 8, 240, Math.PI * 2 - gap);
    var m = new T.MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.35 + i * 0.06, depthWrite: false });
    var mesh = new T.Mesh(g, m);
    mesh.rotation.z = i * 0.85;
    group.add(mesh);
    rings.push({ mesh: mesh, speed: (i % 2 ? -1 : 1) * (2 * Math.PI) / (30 + i * 9), base: i * 0.85 });
    geos.push(g); mats.push(m);
  }

  var cg = new T.CircleGeometry(0.052, 48), cm = new T.MeshBasicMaterial({ color: 0xff5a1f }), core = new T.Mesh(cg, cm);
  group.add(core);

  var hgeo = new T.PlaneGeometry(0.8, 0.8), hU = { uSig: { value: new T.Color() }, uT: { value: 0 } };
  var hmat = new T.ShaderMaterial({ uniforms: hU, transparent: true, depthWrite: false, vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform vec3 uSig;uniform float uT;varying vec2 v;void main(){float r=length(v-.5);float a=exp(-r*11.)*(.32+.06*sin(uT*1.4));gl_FragColor=vec4(uSig,a);}' });
  var halo = new T.Mesh(hgeo, hmat); halo.position.z = -0.01; group.add(halo);

  return {
    size: function (w, h) { cam.aspect = w / h; cam.updateProjectionMatrix(); },
    frame: function (t, c) {
      for (var j = 0; j < rings.length; j++) {
        var o = rings[j];
        o.mesh.rotation.z = o.base + t * o.speed;
        mats[j].color.set(c.text || '#0C0C0C');
      }
      core.scale.setScalar(1 + 0.08 * Math.sin(t * 1.4));
      cm.color.set(c.sig || '#FF5A1F');
      hU.uSig.value.set(c.sig || '#FF5A1F'); hU.uT.value = t;
      r.render(sc, cam);
    },
    dispose: function () { geos.forEach(function (x) { x.dispose(); }); mats.forEach(function (x) { x.dispose(); }); cg.dispose(); cm.dispose(); hgeo.dispose(); hmat.dispose(); }
  };
}
