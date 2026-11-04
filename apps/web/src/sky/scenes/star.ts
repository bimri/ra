// @ts-nocheck: the Ra design canvas's own scene code (App UI v2, D2 Your star), ported as is.
// Your star: a four-point flare with three thin orbits, one for each phrase it came from.
// Called as scene(THREE, renderer, options, colours) → { size(w, h), frame(t, colours), dispose() }.

export default function star(T, r, O, c) {
  return (function (T, r, O) {
  var sc = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, 0.1, 100); cam.position.set(0, 0, 7);
  var U = { uT: { value: 0 }, uSig: { value: new T.Color() }, uHi: { value: new T.Color() } };
  var core = new T.Mesh(new T.PlaneGeometry(3.6, 3.6), new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: [
      'uniform float uT;uniform vec3 uSig,uHi;varying vec2 v;',
      'void main(){vec2 c=v-.5;float r=length(c);float tw=.86+.14*sin(uT*1.3)*sin(uT*.7+1.);',
      'float s1=exp(-abs(c.x)*240.)*exp(-abs(c.y)*(5.2/tw));float s2=exp(-abs(c.y)*240.)*exp(-abs(c.x)*(5.2/tw));',
      'vec2 d=mat2(.7071,-.7071,.7071,.7071)*c;float s3=(exp(-abs(d.x)*300.)*exp(-abs(d.y)*15.)+exp(-abs(d.y)*300.)*exp(-abs(d.x)*15.))*.45;',
      'float core=exp(-r*r*2200.);float halo=exp(-r*16.)*.42+exp(-r*5.)*.12;',
      'float i=clamp(s1+s2+s3+halo+core,0.,1.);vec3 col=mix(uSig,uHi,clamp(core*1.2+(s1+s2)*.35,0.,1.));',
      'gl_FragColor=vec4(col,i);}'
    ].join('\n')
  }));
  sc.add(core);
  var field = new T.Group(); sc.add(field);
  var N = 900, P = new Float32Array(N * 3), A = new Float32Array(N), i;
  for (i = 0; i < N; i++) { var u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rad = 4 + Math.random() * 10, s = Math.sqrt(1 - u * u); P[i * 3] = Math.cos(th) * s * rad; P[i * 3 + 1] = u * rad; P[i * 3 + 2] = Math.sin(th) * s * rad - 4; A[i] = Math.random(); }
  var fg = new T.BufferGeometry(); fg.setAttribute('position', new T.BufferAttribute(P, 3)); fg.setAttribute('aR', new T.BufferAttribute(A, 1));
  var FU = { uT: U.uT, uInk: { value: new T.Color() }, uSig: U.uSig, uDpr: { value: 1 } };
  var fm = new T.ShaderMaterial({
    uniforms: FU, transparent: true, depthWrite: false,
    vertexShader: 'uniform float uT,uDpr;attribute float aR;varying float vA,vS;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;vS=step(.93,aR);gl_PointSize=(1.+aR*1.8+vS*1.2)*uDpr*(9./-mv.z);vA=(.25+.5*aR)*(.6+.4*sin(uT*(.8+aR*2.)+aR*30.));}',
    fragmentShader: 'uniform vec3 uInk,uSig;varying float vA,vS;void main(){float d=length(gl_PointCoord-.5);float m=smoothstep(.5,.2,d);gl_FragColor=vec4(mix(uInk,uSig,vS),m*vA);}'
  });
  field.add(new T.Points(fg, fm));
  var orbits = [], og = [], om = [], bead = new T.SphereGeometry(0.06, 16, 12);
  [[1.5, 0.95, 0.5, 0.2, 0.32], [2.0, 0.7, -0.6, 0.9, 0.22], [2.5, 0.55, 0.25, -0.7, 0.16]].forEach(function (o, j) {
    var g = new T.Group(); g.rotation.set(o[2], o[3], 0); sc.add(g);
    var pts = []; for (var k = 0; k <= 160; k++) { var a = k / 160 * Math.PI * 2; pts.push(new T.Vector3(Math.cos(a) * o[0], Math.sin(a) * o[0] * o[1], 0)); }
    var tg = new T.TubeGeometry(new T.CatmullRomCurve3(pts, true), 160, 0.0065, 5, true), tm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false });
    g.add(new T.Mesh(tg, tm));
    var bm = new T.MeshBasicMaterial({ color: 0xffffff }), b = new T.Mesh(bead, bm); g.add(b);
    orbits.push({ g: g, b: b, o: o, bm: bm, tm: tm }); og.push(tg); om.push(tm, bm);
  });
  var halos = [], hgeo = new T.RingGeometry(0.42, 0.435, 96);
  for (i = 0; i < 2; i++) { var hm = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }); var h = new T.Mesh(hgeo, hm); sc.add(h); halos.push(h); om.push(hm); }
  return {
    size: function (w, h) { cam.aspect = w / h; cam.updateProjectionMatrix(); },
    frame: function (t, c) {
      U.uT.value = t; U.uSig.value.set(c.sig || '#FF5A1F'); U.uHi.value.set(c.hi || '#FFF3E6'); FU.uInk.value.set(c.text || '#F2F1EE'); FU.uDpr.value = r.getPixelRatio();
      field.rotation.y = t * 0.02; field.rotation.x = Math.sin(t * 0.05) * 0.08;
      orbits.forEach(function (o, j) { var a = t * o.o[4] + j * 2.1; o.b.position.set(Math.cos(a) * o.o[0], Math.sin(a) * o.o[0] * o.o[1], 0); o.tm.color.set(c.text || '#F2F1EE'); o.bm.color.set(c.text || '#F2F1EE'); o.g.rotation.z = t * 0.03 * (j % 2 ? -1 : 1); });
      halos.forEach(function (h, j) { var p = ((t / 3.6) + j * 0.5) % 1; h.scale.setScalar(1 + p * 3.4); h.material.opacity = 0.5 * (1 - p) * (1 - p); h.material.color.set(c.sig || '#FF5A1F'); });
      cam.position.x = Math.sin(t * 0.13) * 0.35; cam.position.y = Math.cos(t * 0.11) * 0.25; cam.lookAt(0, 0, 0);
      r.render(sc, cam);
    },
    dispose: function () { core.geometry.dispose(); core.material.dispose(); fg.dispose(); fm.dispose(); og.forEach(function (x) { x.dispose(); }); om.forEach(function (x) { x.dispose(); }); bead.dispose(); hgeo.dispose(); }
  };
})(T, r, O, c);
}
