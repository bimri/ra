// @ts-nocheck: a scene in the canvas's own shape (THREE, renderer, options, colours) → { size, frame, dispose }.
// The Ray's sky, drawn fresh: a luminous sun setting over a calm sea. The sun is white-hot at its heart and
// deepens to your signal colour at the rim, with a halo, a bloom and a faint wash on the air; nearer the
// horizon it reddens and dims. The sea darkens with depth and carries the sun's glitter path: horizontal
// glints that widen toward you, and the sun's broken reflection under the horizon. While you talk, slow
// rings spread from you across the water; while Ra speaks, the glitter swells with the voice.
// Options: hz (horizon, fraction from the top), sx (sun across), sr (sun radius, fraction of width),
// sink (0 at the start of a Ray, 1 when the sun has set), voice ("listen" | "speak" | "calm" | "idle"),
// rise (the sun comes up as the screen opens), bg ("surface" to sit on a card).

export default function ray(T, r, O, c) {
  var sc = new T.Scene(), oc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var U = {
    uRes: { value: new T.Vector2(1, 1) }, uT: { value: 0 }, uHz: { value: 0 }, uSun: { value: new T.Vector2() }, uR: { value: 10 },
    uBg: { value: new T.Color() }, uInk: { value: new T.Color() }, uSig: { value: new T.Color() }, uHi: { value: new T.Color() },
    uV: { value: 0 }, uSpeak: { value: 0 }, uSink: { value: 0 }, uDpr: { value: 1 }, uDark: { value: 0 }, uOn: { value: 1 },
  };
  var vs = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
  var fs = `
precision highp float;
uniform vec2 uRes,uSun;uniform float uT,uHz,uR,uV,uSpeak,uSink,uDpr,uDark,uOn;
uniform vec3 uBg,uInk,uSig,uHi;

float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,3.7);a*=.5;}return s;}

void main(){
  vec2 f=gl_FragCoord.xy;            // pixels, origin bottom-left
  float R=uR, hz=uHz;                // sun radius and horizon height, in pixels
  vec2 sun=uSun;
  // How low the sun sits: 0 high in the sky, 1 touching the horizon and below.
  float low=clamp(1.-(sun.y-hz)/(R*2.2),0.,1.);
  // The sun's light: white-hot heart, signal rim; warmer and dimmer as it nears the horizon.
  vec3 heart=mix(vec3(1.,.985,.96),mix(vec3(1.,.93,.86),uSig,.25),low*.6);
  vec3 rim=mix(uSig,uSig*vec3(.92,.62,.52),low*.55);
  vec3 glowC=mix(mix(uSig,uHi,.35),uSig,low*.5);

  vec3 col=vec3(0.);float a=0.;

  if(f.y>=hz){
    // ── the sky: only light, so the paper shows through ──
    vec2 d=f-sun;float rr=length(d);float t=rr/R;
    float o=max(rr-R,0.);
    float breathe=1.+.18*uV+.12*uSpeak*sin(uT*3.1);
    float glow=(.62*exp(-o/(R*.10))+.30*exp(-o/(R*.55))+.12*exp(-o/(R*2.2)))*breathe;
    // A low band of warm air along the horizon, stronger as the sun nears it.
    float band=exp(-(f.y-hz)/(R*(.55+.9*low)))*(.10+.30*low)*exp(-pow((f.x-sun.x)/(R*7.),2.));
    float g=clamp(glow+band,0.,1.);
    col=glowC;a=g*.85;
    // The disc: smooth radial gradient, a touch of limb darkening, a soft 1px edge.
    float disc=smoothstep(R+.9*uDpr,R-.9*uDpr,rr);
    float k=smoothstep(0.,1.,pow(clamp(t,0.,1.),1.25));
    vec3 s=mix(heart,rim,k);
    s=mix(s,rim*.9,pow(clamp(t,0.,1.),6.)*.5);
    // Faint drifting texture, so it reads as light and not a sticker.
    s*=1.-.035*fbm(d/R*3.+vec2(uT*.05,0.));
    // Near the horizon the lowest part of the disc fades into the air.
    float sea=smoothstep(0.,R*.35,f.y-hz);
    disc*=mix(1.,sea,low);
    col=mix(col,s,disc);a=max(a,disc);
    a*=uOn;
  } else {
    // ── the sea ──
    float dy=(hz-f.y)/uRes.y;               // 0 at the horizon, growing toward you
    float z=1./(dy*6.+.04);                  // distance into the scene
    float x=(f.x-sun.x)/uRes.x;              // across, centred on the sun
    // Base water: it mirrors the sky. Warm and light under the sun at the horizon, cooler and a
    // little deeper to the sides and toward you.
    vec3 ink=mix(uInk,vec3(.16,.20,.27),.45);
    vec3 side=mix(uBg,ink,uDark>.5?.10:.075);
    vec3 nearC=mix(uBg,ink,uDark>.5?.22:.15);
    col=mix(side,nearC,smoothstep(0.,.42,dy));
    float wash=exp(-pow(x/(.22+dy*.55),2.));
    col=mix(col,mix(uBg,uSig,.62),wash*exp(-dy*3.2)*.42*(1.-low*.25));
    col=mix(col,mix(uBg,uSig,.30),wash*.16);
    a=1.;
    // Halftone: a fine dot field in the boards' dotted style, denser and larger toward you.
    float cell=(4.2+dy*5.)*uDpr;vec2 gc=(floor(f/cell)+.5)*cell;
    float dr=(.14+.30*smoothstep(0.,.5,dy))*cell*(.75+.5*fbm(gc/uRes.x*vec2(3.,9.)+vec2(0.,uT*.08)));
    float dots=smoothstep(dr+.7*uDpr,dr-.3*uDpr,length(f-gc))*smoothstep(0.,.02,dy);
    col=mix(col,mix(col,uInk,uDark>.5?-.0:.30),dots*.5*(1.-wash*.8));
    col=mix(col,mix(uSig,heart,.15),dots*wash*.55);
    // Swell: long soft lines, compressed with distance, drifting toward you.
    float sw=fbm(vec2(x*z*1.3,z*1.1-uT*.22));
    float lines=smoothstep(.56,.78,sw)*(1.-smoothstep(.78,.94,sw));
    col=mix(col,mix(uBg,ink,uDark>.5?.0:.30),lines*.32*smoothstep(0.,.015,dy));
    // Your voice on the water: slow rings from the bottom centre, only while you talk.
    vec2 me=vec2(.5*uRes.x,-.12*uRes.y);vec2 q=(f-me)/vec2(uRes.x,uRes.y*.45);float ql=length(q);
    float ring=sin(ql*38.-uT*3.2)*.5+.5;ring=pow(ring,8.)*uV*exp(-ql*1.4)*smoothstep(0.,.05,dy);
    col=mix(col,mix(uBg,uSig,.35),ring*.6);
    // The glitter path: glints in rows, wider toward you, swelling with Ra's voice.
    // The glitter path, the hero of the water: bright horizontal dashes, white-hot at the centre and
    // orange outward, longer and further apart as they come toward you. Ra's voice swells it.
    float width=(.06+dy*.62)*(1.+.22*uSpeak);
    float path=exp(-pow(x/width,2.));
    float rowH=(2.2+dy*7.)*uDpr;
    float row=floor((hz-f.y)/rowH);
    float rowFrac=fract((hz-f.y)/rowH);
    float dashLen=(.010+dy*.09);
    float seed=h21(vec2(row,7.));
    float drift=uT*(.010+.02*seed)*(seed>.5?1.:-1.);
    float dash=vn(vec2((x+drift)/dashLen+seed*50.,row*1.7+uT*(.6+seed)));
    float near0=1.-smoothstep(0.,.12,dy);
    float on=smoothstep(.56-.34*path-.12*near0,.74-.22*path-.08*near0,dash);
    float glint=on*path*step(rowFrac,.42+.18*smoothstep(0.,.4,dy))*smoothstep(0.,.004,dy);
    glint*=(1.-low*.30)*(1.+.40*uSpeak*(.5+.5*sin(uT*5.+row)));
    vec3 glc=mix(uSig,heart,pow(path,3.)*(.55+.45*smoothstep(.85,1.,dash)));
    col=mix(col,glc,clamp(glint*1.15,0.,1.)*uOn);
    // The sun's reflection, broken by the water, just under the horizon.
    float ry=(hz-f.y);float rx=f.x-sun.x+ (vn(vec2(row*.9,uT*1.5))-.5)*R*.35*smoothstep(0.,R,ry);
    float refl=smoothstep(R*.95,R*.75,abs(rx))*exp(-ry/(R*(1.1-low*.5)))*step(rowFrac,.7);
    col=mix(col,mix(rim,heart,.35),refl*.75*uOn*(1.-low*.4));
    // A crisp horizon line, a touch warmer under the sun.
    float line=1.-smoothstep(0.,1.2*uDpr,abs(f.y-hz+.5*uDpr));
    col=mix(col,mix(mix(uBg,uInk,.35),uSig,exp(-pow(x/.12,2.))*.6),line*.8);
    // Fade toward the bottom, where the voice card sits.
    a*=1.-smoothstep(.55,1.,dy/(hz/uRes.y))*.25;
  }
  gl_FragColor=vec4(col*a,a);
}`;
  var mat = new T.ShaderMaterial({ uniforms: U, vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true });
  var quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; sc.add(quad);
  var W = 1, H = 1;
  return {
    size: function (w, h) { W = w; H = h; },
    frame: function (t, c) {
      var dpr = r.getPixelRatio(), w = W * dpr, h = H * dpr;
      U.uRes.value.set(w, h); U.uT.value = t; U.uDpr.value = dpr;
      U.uBg.value.set((O.bg === 'surface' ? c.surface : c.bg) || '#ECEBE7'); U.uInk.value.set(c.text || '#0C0C0C');
      U.uSig.value.set(c.sig || '#FF5A1F'); U.uHi.value.set(c.hi || '#FFF3E6');
      U.uDark.value = c.dark ? 1 : 0; U.uOn.value = c.sun === false ? 0 : 1;
      var sink = Math.max(0, Math.min(1.2, O.sink || 0)); U.uSink.value = sink;
      var hz = h * (1 - (O.hz !== undefined ? O.hz : 0.54)); U.uHz.value = hz;
      var R = (O.sr || 0.12) * w; U.uR.value = R;
      // The sun sets as the Ray goes on: well up at the start, below the horizon at the end.
      // First light: the sun rises into place as the screen opens.
      var rise = O.rise ? Math.min(1, t / 6) : 1, ease = 1 - Math.pow(1 - rise, 3);
      var sy = hz + R * (1.35 - sink * 2.5) + R * 0.05 * Math.sin(t * 0.2) - (1 - ease) * R * 2.6;
      U.uSun.value.set((O.sx !== undefined ? O.sx : 0.5) * w, sy);
      var v = 0, m = O.voice, sp = 0;
      if (m === 'listen') v = 0.55 + 0.35 * Math.sin(t * 2.3) * Math.sin(t * 0.71 + 1.3);
      else if (m === 'speak') sp = 1;
      U.uV.value = Math.max(0, Math.min(1, v)); U.uSpeak.value = sp;
      r.render(sc, oc);
    },
    dispose: function () { mat.dispose(); quad.geometry.dispose(); },
  };
}
