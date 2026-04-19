import numpy as np
from fastapi import FastAPI
from kepler import kepler_to_cartesian
from propagator import rk4_step
from constants import MU
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok"}


@app.post("/simulate")
def simulate(params: dict):
    a    = params.get("a")
    e    = params.get("e")
    i    = params.get("i")
    sats = params["satellites"]
    dt   = 10
    steps = 2000

    result = []

    for sat in sats:
        if "r0" in sat and "v0" in sat:
            r = np.array(sat["r0"], dtype=float)
            v = np.array(sat["v0"], dtype=float)
        else:
            r, v = kepler_to_cartesian(a, e, i, sat["raan"], 0, sat["nu"], MU)

        traj = []
        for _ in range(steps):
            r, v = rk4_step(r, v, dt)
            traj.append(r.tolist())

        result.append({
            "positions": traj,
            "final_v":   v.tolist()
        })

    # Кольца орбитальных плоскостей — только при первом запросе (есть a, e, i)
    rings = []
    if a is not None:
        seen = set()
        for sat in sats:
            if "raan" not in sat:
                continue
            raan_key = round(sat["raan"], 8)
            if raan_key in seen:
                continue
            seen.add(raan_key)
            ring_pts = []
            for k in range(128):
                nu_k = 2 * np.pi * k / 128
                r_k, _ = kepler_to_cartesian(a, e, i, sat["raan"], 0, nu_k, MU)
                ring_pts.append(r_k.tolist())
            rings.append(ring_pts)

    return {"trajectories": result, "rings": rings}
