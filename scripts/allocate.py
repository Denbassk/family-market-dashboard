"""Greedy allocation for store-to-store moves.

The SQL builds a cartesian product of donors x receivers, so the same donor
stock is offered to every receiver and the same receiver need is filled by
every donor. This module turns those suggestions into a feasible plan:
each donor cannot give more than donor_stock, each receiver cannot get more
than (recv_month - recv_stock).
"""

def _f(x):
    return float(x or 0)


def allocate_moves(raw, min_value=0.0):
    if not raw:
        return [], {"pairs_before": 0, "pairs_after": 0}

    need_cols = ("product", "donor", "receiver", "donor_stock",
                 "recv_month", "recv_stock", "move_qty", "value")
    missing = [c for c in need_cols if c not in raw[0]]
    if missing:
        raise RuntimeError("allocate_moves: missing columns %s" % missing)

    donor_left, recv_left = {}, {}
    for r in raw:
        dk = (r["donor"], r["product"])
        rk = (r["receiver"], r["product"])
        donor_left[dk] = max(donor_left.get(dk, 0.0), _f(r["donor_stock"]))
        recv_left[rk] = max(recv_left.get(rk, 0.0),
                            max(0.0, _f(r["recv_month"]) - _f(r["recv_stock"])))
    donor_cap = dict(donor_left)
    recv_cap = dict(recv_left)

    order = sorted(raw, key=lambda r: (-_f(r["recv_sells"]), -_f(r["value"]),
                                       str(r["product"]), str(r["donor"]),
                                       str(r["receiver"])))
    out = []
    for r in order:
        dk = (r["donor"], r["product"])
        rk = (r["receiver"], r["product"])
        q = int(min(_f(r["move_qty"]), donor_left.get(dk, 0.0), recv_left.get(rk, 0.0)))
        if q <= 0:
            continue
        unit = _f(r["value"]) / _f(r["move_qty"]) if _f(r["move_qty"]) else 0.0
        val = round(unit * q, 0)
        if val < min_value:
            continue
        donor_left[dk] -= q
        recv_left[rk] -= q
        nr = dict(r)
        nr["move_qty"] = q
        nr["value"] = val
        nr["move_qty_suggested"] = int(_f(r["move_qty"]))
        nr["donor_left"] = int(donor_left[dk])
        out.append(nr)

    verify(out, donor_cap, recv_cap)
    out.sort(key=lambda r: (-_f(r["value"]), -_f(r["recv_sells"]), str(r["product"])))

    rep = {
        "pairs_before": len(raw),
        "pairs_after": len(out),
        "qty_before": int(sum(_f(r["move_qty"]) for r in raw)),
        "qty_after": int(sum(_f(r["move_qty"]) for r in out)),
        "value_before": int(sum(_f(r["value"]) for r in raw)),
        "value_after": int(sum(_f(r["value"]) for r in out)),
        "donors_used": len({(r["donor"], r["product"]) for r in out}),
        "min_value": min_value,
    }
    return out, rep


def verify(rows, donor_cap, recv_cap):
    d_sum, r_sum = {}, {}
    for r in rows:
        q = _f(r["move_qty"])
        if q <= 0:
            raise RuntimeError("zero move survived: %r" % (r,))
        dk = (r["donor"], r["product"])
        rk = (r["receiver"], r["product"])
        d_sum[dk] = d_sum.get(dk, 0.0) + q
        r_sum[rk] = r_sum.get(rk, 0.0) + q
    for k, v in d_sum.items():
        if v > donor_cap.get(k, 0.0) + 1e-6:
            raise RuntimeError("donor overdraft %r: %s of %s" % (k, v, donor_cap.get(k)))
    for k, v in r_sum.items():
        if v > recv_cap.get(k, 0.0) + 1e-6:
            raise RuntimeError("receiver overfill %r: %s of %s" % (k, v, recv_cap.get(k)))
    return True