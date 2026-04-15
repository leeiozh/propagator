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
    a = params["a"]
    e = params["e"]
    i = params["i"]

    sats = params["satellites"]

    dt = 10
    steps = 2000

    result = []

    for sat in sats:
        r, v = kepler_to_cartesian(
            a, e, i,
            sat["raan"],
            0,
            sat["nu"],
            MU
        )

        traj = []

        for _ in range(steps):
            r, v = rk4_step(r, v, dt)
            traj.append(r.tolist())

        result.append(traj)

    return {"trajectories": result}
