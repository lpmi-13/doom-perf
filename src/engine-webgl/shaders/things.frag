precision mediump float;

uniform sampler2D tex;
uniform float lightIntensity;
uniform float hitFlash;

varying vec3 vPos;
varying vec2 vUv;

void main(void) {
  vec4 col = texture2D(tex, vUv);
  
  if (col.a < 0.1) {
    discard;
  }
  
  //fake distance-based darkening
  float fakeDepthLighting = clamp(gl_FragCoord.w * 500.0, 0.0, 1.0);

  vec3 litColor = col.xyz * lightIntensity * fakeDepthLighting;
  vec3 flashColor = mix(litColor, vec3(1.0, 0.2, 0.2), hitFlash);
  gl_FragColor = vec4(flashColor, 1.0);
}
