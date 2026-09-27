// "The live conduit" fragment shader.
//
// One full-screen pass draws the circuit board behind the hero story in world
// space (CSS px, origin bottom-left), seen through a 2D camera `u_cam` =
// (x, y, zoom). The server card and browser window are HTML laid over the top;
// the shader draws everything between and around them:
//   - the grid, ambient signals, and the cursor "probe": current flows along
//     the traces toward the pointer, and a press discharges along them
//   - the server and browser footprints, which "compile" out of grid cells as
//     they appear (u_srvOn, u_brwOn) and glow when they fire (u_srvHit, u_brwHit)
//   - the conduit between them, drawn in (u_draw), the tangle of old-stack
//     routes that merges into it (u_stack), and the three transport lanes it
//     splits into (u_tx)
//   - arcs: an event or a patch crossing the wire. u_arcUp / u_arcDn are
//     (head distance, intensity, lane, unused); they cross in a few frames and
//     light the whole wire at once, like current, instead of travelling.
export const storyFrag = `precision highp float;
uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;uniform float u_light;uniform float u_px;
uniform vec3 u_bg;uniform vec3 u_ink;uniform vec3 u_acc;
uniform vec3 u_cam;uniform float u_out;uniform float u_amb;uniform float u_probe;uniform vec3 u_zap;
uniform vec4 u_srv;uniform vec4 u_brw;uniform vec2 u_ta;uniform vec2 u_tb;uniform float u_vert;
uniform float u_srvOn;uniform float u_brwOn;uniform float u_srvHit;uniform float u_brwHit;uniform float u_conv;
uniform float u_draw;uniform vec2 u_stack;uniform float u_tx;uniform vec4 u_arcUp;uniform vec4 u_arcDn;
const float C=32.0;
float aa,W,Z;
float h1(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ln(float d,float w){return 1.0-smoothstep(w*W,w*W+aa,d);}
vec2 segH(vec2 p,float x0,float x1,float y){float lo=min(x0,x1),hi=max(x0,x1);float dx=max(0.0,max(lo-p.x,p.x-hi));return vec2(length(vec2(dx,p.y-y)),clamp(abs(p.x-x0),0.0,hi-lo));}
// A three-segment routed wire A -> B, shifted sideways by o with its middle
// run moved by sh. Returns distance to it, distance along it, and its length.
vec3 lane(vec2 p,vec2 A,vec2 B,float o,float sh){
  float sx=B.x>=A.x?1.0:-1.0;float sy=B.y>=A.y?1.0:-1.0;
  float mx=floor((A.x+B.x)*0.5/C+0.5)*C+sh-o*sx*sy;
  float y0=A.y+o,y1=B.y+o;
  vec2 a=segH(p,A.x,mx,y0);float l1=abs(mx-A.x);
  vec2 b=segH(p.yx,y0,y1,mx);float l2=abs(y1-y0);
  vec2 c=segH(p,mx,B.x,y1);float l3=abs(B.x-mx);
  vec3 r=vec3(a.x,a.y,0.0);
  if(b.x<r.x)r=vec3(b.x,l1+b.y,0.0);
  if(c.x<r.x)r=vec3(c.x,l1+l2+c.y,0.0);
  r.z=l1+l2+l3;return r;
}
float sdBox(vec2 p,vec4 r){vec2 d=abs(p-r.xy)-r.zw;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
// Light from an arc on a lane: the whole wire behind the head, plus a hot core.
float arc(vec3 r,vec4 a,float dir){
  if(a.y<=0.001)return 0.0;
  float q=dir>0.0?r.y:r.z-r.y;
  float lit=step(q,a.x)*a.y;
  float core=exp(-abs(q-a.x)/6.0)*step(a.x,r.z-1.0)*a.y;
  return max(lit*0.85,core*1.4);
}
void main(){
  vec2 size=u_res/u_px;Z=u_cam.z;aa=1.0/(u_px*Z);W=0.5/Z;
  vec2 scr=gl_FragCoord.xy/u_px;
  vec2 css=(scr-size*0.5)/Z+u_cam.xy;
  vec2 g=css/C;vec2 gi=floor(g);vec2 gf=fract(g);
  vec2 dl=min(gf,1.0-gf)*C;
  float gx=ln(dl.x,1.0),gy=ln(dl.y,1.0);float gridL=max(gx,gy);vec2 li=floor(g+0.5);
  float major=max(gx*step(mod(li.x,4.0),0.5),gy*step(mod(li.y,4.0),0.5));
  vec2 inset=step(vec2(3.0),gf*C)*step(gf*C,vec2(C-3.0));float insq=inset.x*inset.y;
  vec2 cc=(gi+0.5)*C;

  // Ambient signals running along random grid lines.
  float cols=size.x/C;float rows=size.y/C;
  float sH=0.0,sV=0.0,hH=0.0,hV=0.0;
  float hr=h1(li.y);
  if(hr>0.72){float head=(fract(u_time*(0.05+0.08*h1(li.y+17.0))+hr*9.0)*1.6-0.3)*cols;
    float x=hr>0.86?cols-g.x:g.x;float dx=head-x;float tail=dx>=0.0?exp(-dx*0.3):exp(dx*5.0);
    float dy=abs(g.y-li.y)*C;sH=tail*ln(dy,1.2);hH=tail*exp(-dy*0.3*Z);}
  float hc=h1(li.x+71.0);
  if(hc>0.86){float head=(fract(u_time*(0.05+0.07*h1(li.x+3.0))+hc*5.0)*1.6-0.3)*rows;
    float dy=head-(rows-g.y);float tail=dy>=0.0?exp(-dy*0.3):exp(dy*5.0);
    float dxl=abs(g.x-li.x)*C;sV=tail*ln(dxl,1.2);hV=tail*exp(-dxl*0.3*Z);}

  // Cursor probe: the nearest grid node becomes a live pad and current flows
  // toward it along the traces through it and their neighbours.
  vec2 mc=(u_mouse*size-size*0.5)/Z+u_cam.xy;
  vec2 pad=floor(mc/C+0.5)*C;
  vec2 dp=css-pad;
  float near=exp(-dot(css-mc,css-mc)/(2.0*170.0*170.0));
  float probe=0.0;
  for(int k=-1;k<=1;k++){
    float fk=float(k);float wgt=k==0?1.0:0.45;
    float ly=ln(abs(dp.y-fk*C),1.3),lx=ln(abs(dp.x-fk*C),1.3);
    float fh=pow(fract(abs(dp.x)/56.0+u_time*1.7+fk*0.37),10.0)*exp(-abs(dp.x)/(k==0?260.0:150.0));
    float fv=pow(fract(abs(dp.y)/56.0+u_time*1.7+fk*0.61),10.0)*exp(-abs(dp.y)/(k==0?260.0:150.0));
    probe=max(probe,max(ly*fh,lx*fv)*wgt);
  }
  float padR=ln(abs(max(abs(dp.x),abs(dp.y))-5.0),1.3);
  float padF=1.0-smoothstep(2.5,2.5+aa,max(abs(dp.x),abs(dp.y)));
  probe=max(probe,max(padR,padF)*(0.75+0.25*sin(u_time*6.0)));
  probe*=u_probe;

  // Press discharge: a pulse races out along the traces from where you pressed.
  float zap=0.0;
  float age=u_time-u_zap.z;
  if(age>=0.0&&age<1.2){
    vec2 zp=floor(u_zap.xy/C+0.5)*C;vec2 dz=css-zp;
    float front=age*900.0;float fade=exp(-age*3.2);
    float cross=max(ln(abs(dz.y),1.6)*exp(-abs(abs(dz.x)-front)/14.0),ln(abs(dz.x),1.6)*exp(-abs(abs(dz.y)-front)/14.0));
    float L1=abs(dz.x)+abs(dz.y);
    float dia=gridL*exp(-abs(L1-front*0.7)/10.0)*exp(-L1/500.0);
    zap=(cross+dia*0.8)*fade;
  }

  // Server and browser footprints.
  float sdS=sdBox(css,u_srv);float sdB=sdBox(css,u_brw);
  float inS=step(sdBox(cc,u_srv),0.0);float inB=step(sdBox(cc,u_brw),0.0);
  float tS=h2(gi)*0.55;float onS=smoothstep(tS,tS+0.25,u_srvOn);
  float fS=inS*insq*onS*(1.0-smoothstep(tS+0.25,tS+0.55,u_srvOn));
  vec2 dpB=abs(cc-u_tb);float tB=clamp((dpB.x+dpB.y)/max(1.0,2.0*(u_brw.z+u_brw.w)),0.0,1.0)*0.6+h2(gi+3.0)*0.12;
  float onB=smoothstep(tB,tB+0.2,u_brwOn);
  float fB=inB*insq*onB*(1.0-smoothstep(tB+0.2,tB+0.5,u_brwOn));
  float haloS=exp(-max(sdS,0.0)/(26.0+30.0*u_srvHit))*u_srvOn*(0.25+0.9*u_srvHit)*step(0.0,sdS);
  float haloB=exp(-max(sdB,0.0)/(26.0+30.0*u_brwHit))*u_brwOn*(0.2+0.9*u_brwHit)*step(0.0,sdB);
  // Signals converging into the server while it compiles.
  float Ls=max(abs(css.x-u_srv.x)-u_srv.z,0.0)+max(abs(css.y-u_srv.y)-u_srv.w,0.0);
  float sel=max(gx*step(0.4,h1(li.y+5.0)),gy*step(0.4,h1(li.x+9.0)));
  float inW=pow(1.0-fract(Ls/224.0+u_time*0.8),9.0)*sel*u_conv*(0.3+0.7*exp(-Ls/700.0))*step(4.0,sdS);

  // Wires.
  float wire=0.0,spark=0.0,glow=0.0,stack=0.0;
  if(u_draw>0.001){
    vec2 P=css,A=u_ta,B=u_tb;if(u_vert>0.5){P=P.yx;A=A.yx;B=B.yx;}
    for(int k=-1;k<=1;k++){
      float fk=float(k);
      if(k!=0&&u_tx<0.001)continue;
      vec3 r=lane(P,A,B,fk*C*u_tx,0.0);
      float head=r.z*u_draw;
      float vis=step(r.y,head+0.5)*(k==0?1.0:smoothstep(0.0,0.4,u_tx));
      wire=max(wire,ln(r.x,1.3)*vis);
      float tip=exp(-abs(r.y-head)/16.0)*(1.0-step(0.999,u_draw))*vis;
      float up=arc(r,u_arcUp,-1.0)*step(abs(u_arcUp.z-fk),0.5);
      float dn=arc(r,u_arcDn,1.0)*step(abs(u_arcDn.z-fk),0.5);
      float a=max(max(up,dn),tip)*vis;
      spark=max(spark,a*ln(r.x,2.2));
      glow=max(glow,a*exp(-r.x*0.2*Z));
    }
    // The old stack: alternate routes that merge into the one conduit.
    if(u_stack.x>0.001){
      float m=u_stack.y;
      for(int k=0;k<3;k++){
        float fk=float(k);
        float o=(fk==0.0?-48.0:fk==1.0?40.0:88.0)*(1.0-m);
        float sh=(fk==0.0?-128.0:fk==1.0?96.0:192.0)*(1.0-m);
        vec3 r=lane(P,A,B,o,sh);
        float dash=step(0.45,fract(r.y/12.0-u_time*(0.6+0.3*fk)));
        stack=max(stack,ln(r.x,1.2)*dash);
      }
      stack*=u_stack.x*(1.0-m);
    }
  }

  float ph=u_time*0.5+h2(gi)*20.0;
  float fl=step(0.975,h2(gi+floor(ph)*1.37))*pow(1.0-fract(ph),2.0)*insq*(1.0-inS*u_srvOn)*(1.0-inB*u_brwOn);
  vec3 col=u_bg;
  float gA=mix(0.06,0.12,major)+near*0.22*u_probe;
  col=mix(col,mix(u_ink,u_acc,clamp(near*0.9*u_probe,0.0,1.0)),gridL*clamp(gA,0.0,1.0));
  col=mix(col,u_acc,fl*0.16*u_amb);
  col=mix(col,u_acc,clamp((sH+sV)*u_amb*0.9,0.0,1.0));
  col=mix(col,u_ink,clamp(stack*0.45,0.0,1.0));
  col=mix(col,u_acc,clamp(inW+fS*0.7+fB*0.7,0.0,1.0));
  col=mix(col,u_acc,clamp(wire*0.45+spark,0.0,1.0));
  col=mix(col,u_acc,clamp(probe+zap,0.0,1.0));
  float halo=haloS+haloB;
  col+=(u_acc*(hH+hV)*u_amb*0.1+u_acc*(halo*0.22+glow*0.35+probe*0.15+zap*0.2))*(1.0-u_light);
  col=mix(col,u_acc,clamp((halo*0.12+glow*0.25)*u_light,0.0,1.0));
  vec2 uv=gl_FragCoord.xy/u_res;
  float vg=smoothstep(1.25,0.4,length((uv-0.5)*vec2(1.3,1.0)));
  col=mix(u_bg,col,mix(0.55,1.0,vg));
  gl_FragColor=vec4(mix(col,u_bg,u_out),1.0);
}`
