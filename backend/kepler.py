import numpy as np


def kepler_to_cartesian(a, e, i, raan, argp, nu, mu):
    p = a * (1 - e ** 2)

    r_pf = np.array([
        p * np.cos(nu) / (1 + e * np.cos(nu)),
        p * np.sin(nu) / (1 + e * np.cos(nu)),
        0
    ])

    v_pf = np.array([
        -np.sqrt(mu / p) * np.sin(nu),
        np.sqrt(mu / p) * (e + np.cos(nu)),
        0
    ])

    R3_W = rotation_z(raan)
    R1_i = rotation_x(i)
    R3_w = rotation_z(argp)

    Q = R3_W @ R1_i @ R3_w

    r = Q @ r_pf
    v = Q @ v_pf

    return r, v


def rotation_x(angle):
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rotation_z(angle):
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
