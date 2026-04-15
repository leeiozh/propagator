import numpy as np
from constants import MU, R_E, J2


def acceleration(r):
    x, y, z = r
    r_norm = np.linalg.norm(r)

    a_grav = -MU * r / r_norm ** 3

    factor = 1.5 * J2 * MU * R_E ** 2 / r_norm ** 5
    zx = 5 * z ** 2 / r_norm ** 2

    a_j2 = factor * np.array([
        x * (zx - 1),
        y * (zx - 1),
        z * (zx - 3)
    ])

    return a_grav + a_j2


def rk4_step(r, v, dt):
    def f(r, v):
        return v, acceleration(r)

    k1_v, k1_a = f(r, v)
    k2_v, k2_a = f(r + 0.5 * dt * k1_v, v + 0.5 * dt * k1_a)
    k3_v, k3_a = f(r + 0.5 * dt * k2_v, v + 0.5 * dt * k2_a)
    k4_v, k4_a = f(r + dt * k3_v, v + dt * k3_a)

    r_new = r + dt / 6 * (k1_v + 2 * k2_v + 2 * k3_v + k4_v)
    v_new = v + dt / 6 * (k1_a + 2 * k2_a + 2 * k3_a + k4_a)

    return r_new, v_new
