// =====================
// КОНСТАНТЫ
// =====================
const CONST = {
    R_EARTH: 6378137,
    SCALE: 1 / 6378137,
    SAT_SIZE: 0.02,
    EARTH_COLOR: 0x051650
};

// =====================
// СЦЕНА
// =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// камера
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, -3, 2);

// renderer
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("left").appendChild(renderer.domElement);

// controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);

// свет (простой и стабильный)
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

// =====================
// ЗЕМЛЯ (СТАБИЛЬНАЯ)
// =====================
const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshPhongMaterial({
        color: CONST.EARTH_COLOR,
        shininess: 5
    })
);
scene.add(earth);

function addEarthAxis() {
    const axisGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.5, 0),
        new THREE.Vector3(0, 1.5, 0)
    ]);

    const axis = new THREE.Line(
        axisGeom,
        new THREE.LineBasicMaterial({color: 0xffcc00})
    );

    scene.add(axis);
}

addEarthAxis();

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 2, 3);  // направление света
scene.add(sun);

// слабая подсветка ночной стороны
scene.add(new THREE.AmbientLight(0x222233, 0.3));

// =====================
// СПУТНИКИ
// =====================
let satMeshes = [];
let trajectoriesGlobal = [];
let step = 0;
let orbitLines = [];

function getColor(i, total) {
    const hue = i / total;
    const color = new THREE.Color();
    color.setHSL(hue, 1.0, 0.5);
    return color;
}

function createSatellite(color) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(CONST.SAT_SIZE, 8, 8),
        new THREE.MeshBasicMaterial({color})
    );
    scene.add(mesh);
    return mesh;
}

// создание спутника
function createSatellite() {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(CONST.SAT_SIZE, 8, 8),
        new THREE.MeshBasicMaterial({color: 0xff0000})
    );
    scene.add(mesh);
    return mesh;
}

// =====================
// ОРБИТЫ
// =====================
function drawOrbit(traj, color) {

    const points = traj.map(p =>
        new THREE.Vector3(
            p[0] * CONST.SCALE,
            p[1] * CONST.SCALE,
            p[2] * CONST.SCALE
        )
    );

    const geom = new THREE.BufferGeometry().setFromPoints(points);

    const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({color})
    );

    scene.add(line);
    orbitLines.push(line);
}

// =====================
// ЗАПУСК
// =====================
function runSim() {

    // очистка
    satMeshes.forEach(s => scene.remove(s));
    satMeshes = [];

    orbitLines.forEach(o => scene.remove(o));
    orbitLines = [];

    const params = getParams();

    fetch("http://127.0.0.1:8000/simulate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(params)
    })
        .then(res => res.json())
        .then(data => {

            trajectoriesGlobal = data.trajectories;

            // создаём спутники
            for (let i = 0; i < trajectoriesGlobal.length; i++) {
                const color = getColor(i, trajectoriesGlobal.length);

                satMeshes.push(createSatellite(color));
                drawOrbit(trajectoriesGlobal[i], color);
            }

        });
}

// =====================
// АНИМАЦИЯ 3D
// =====================
function update3D() {

    for (let i = 0; i < satMeshes.length; i++) {

        const traj = trajectoriesGlobal[i];
        const mesh = satMeshes[i];

        if (!traj || !mesh) continue;

        const p = traj[step % traj.length];

        mesh.position.set(
            p[0] * CONST.SCALE,
            p[1] * CONST.SCALE,
            p[2] * CONST.SCALE
        );
    }

    step++;
}

// =====================
// 2D КАРТА
// =====================
const canvas2d = document.createElement("canvas");
document.getElementById("top2d").appendChild(canvas2d);
const ctx = canvas2d.getContext("2d");

// простая карта (контуры)
function drawEarthMap(w, h) {
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;

    // экватор
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // меридианы
    for (let i = 0; i <= 6; i++) {
        const x = i * w / 6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}

// перевод XYZ → lat/lon
function xyzToLatLon(p) {
    const r = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    return {
        lat: Math.asin(p[2] / r),
        lon: Math.atan2(p[1], p[0])
    };
}

// анимация 2D
function update2D() {

    const w = canvas2d.width = canvas2d.clientWidth;
    const h = canvas2d.height = canvas2d.clientHeight;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    drawEarthMap(w, h);

    ctx.fillStyle = "#00ff88";

    for (let i = 0; i < trajectoriesGlobal.length; i++) {

        const traj = trajectoriesGlobal[i];
        if (!traj) continue;

        const p = traj[step % traj.length];

        const {lat, lon} = xyzToLatLon(p);

        const x = (lon + Math.PI) / (2 * Math.PI) * w;
        const y = (Math.PI / 2 - lat) / Math.PI * h;

        ctx.fillRect(x, y, 4, 4);
    }
}


// =====================
// ГЛАВНЫЙ LOOP
// =====================
function animate() {

    requestAnimationFrame(animate);

    update3D();
    update2D();

    controls.update();
    renderer.render(scene, camera);
}

animate();