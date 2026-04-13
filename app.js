(function () {
  "use strict";

  const DEFAULTS = {
    D: 0.920,
    H: 0.070,
    S: 0.400,
    alpha: 10.08,
    L: 0.400,
    m1: 0.25,
    l1: 0.15,
    x1: 0.08,
    k1: 120.0,
    eta1: 0.8,
    m2: 0.25,
    l2: 0.15,
    x2: 0.08,
    k2: 120.0,
    eta2: 0.8,
    mu: 0.03,
    mup: 0.02,
    e: 0.4,
    g: 9.81
  };

  const PARAM_SECTIONS = [
    {
      title: "轨道参数",
      fields: [
        ["D", "平直段 D", "m", "0.001"],
        ["H", "平台高度 H", "m", "0.001"],
        ["S", "平台宽度 S", "m", "0.001"],
        ["alpha", "坡角 alpha", "deg", "0.01"],
        ["L", "坡道长度 L", "m", "0.001"]
      ]
    },
    {
      title: "我方小车",
      fields: [
        ["m1", "质量 m1", "kg", "0.001"],
        ["l1", "车长 l1", "m", "0.001"],
        ["x1", "后拉距离 x1", "m", "0.001"],
        ["k1", "弹簧刚度 k1", "N/m", "0.1"],
        ["eta1", "能量效率 eta1", "", "0.01"]
      ]
    },
    {
      title: "对手小车",
      fields: [
        ["m2", "质量 m2", "kg", "0.001"],
        ["l2", "车长 l2", "m", "0.001"],
        ["x2", "后拉距离 x2", "m", "0.001"],
        ["k2", "弹簧刚度 k2", "N/m", "0.1"],
        ["eta2", "能量效率 eta2", "", "0.01"]
      ]
    },
    {
      title: "公共参数",
      fields: [
        ["mu", "轨道阻力系数 mu", "", "0.001"],
        ["mup", "平台阻力系数 mu_p", "", "0.001"],
        ["e", "恢复系数 e", "", "0.01"],
        ["g", "重力加速度 g", "m/s²", "0.01"]
      ]
    }
  ];

  const METRICS = [
    ["Es1", "我方储能", "J"],
    ["Es2", "对手储能", "J"],
    ["v10", "我方初速度", "m/s"],
    ["v20", "对手初速度", "m/s"],
    ["vP1", "我方上台速度", "m/s"],
    ["vP2", "对手上台速度", "m/s"],
    ["tarr1", "我方到达时间", "s"],
    ["tarr2", "对手到达时间", "s"],
    ["xc", "碰撞点", "m"],
    ["v1_after", "我方碰后速度", "m/s"],
    ["v2_after", "对手碰后速度", "m/s"],
    ["sstop1", "我方停止距离", "m"]
  ];

  const SYNC_MAP = {
    m1: "m2",
    l1: "l2",
    x1: "x2",
    k1: "k2",
    eta1: "eta2"
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const inputMap = {};

  function rad(deg) {
    return deg * Math.PI / 180;
  }

  function fmt(value, digits = 4) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    const fixed = Math.abs(value) >= 100 ? 3 : digits;
    return value.toFixed(fixed).replace(/\.?0+$/, "");
  }

  function mathNum(value, digits = 4) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return value.toFixed(digits);
  }

  function cloneParams(params) {
    return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Number(value)]));
  }

  function calculateModel(rawParams) {
    const params = cloneParams(rawParams);
    const result = { success: false, message: "" };

    const alpha = params.alpha;
    if (!(alpha > 0 && alpha < 90)) {
      result.message = "坡角 alpha 必须在 (0, 90)° 内。";
      return result;
    }
    if (params.m1 <= 0 || params.m2 <= 0) {
      result.message = "质量必须大于 0。";
      return result;
    }
    if (params.l1 <= 0 || params.l2 <= 0) {
      result.message = "车长必须大于 0。";
      return result;
    }
    if (params.x1 < 0 || params.x2 < 0) {
      result.message = "后拉距离不能为负。";
      return result;
    }
    if (params.mu < 0 || params.mup < 0) {
      result.message = "阻力系数不能为负。";
      return result;
    }
    if (!(params.e >= 0 && params.e <= 1)) {
      result.message = "恢复系数 e 应在 [0, 1] 内。";
      return result;
    }

    const { D, S, L, m1, m2, l1, l2, x1, x2, k1, k2, eta1, eta2, mu, mup, e, g } = params;

    result.Es1 = 0.5 * k1 * x1 ** 2;
    result.Es2 = 0.5 * k2 * x2 ** 2;

    result.v10 = x1 * Math.sqrt(eta1 * k1 / m1);
    result.v20 = x2 * Math.sqrt(eta2 * k2 / m2);

    const vD1Sq = result.v10 ** 2 - 2 * mu * g * D;
    const vD2Sq = result.v20 ** 2 - 2 * mu * g * D;

    if (vD1Sq <= 0) {
      result.message = "我方储能不足，经过平直段后已无法继续运动。";
      return result;
    }
    if (vD2Sq <= 0) {
      result.message = "对手储能不足，经过平直段后已无法继续运动。";
      return result;
    }

    result.vD1 = Math.sqrt(vD1Sq);
    result.vD2 = Math.sqrt(vD2Sq);

    const sinA = Math.sin(rad(alpha));
    const cosA = Math.cos(rad(alpha));
    const slopeTerm = sinA + mu * cosA;

    const vP1Sq = result.vD1 ** 2 - 2 * g * L * slopeTerm;
    const vP2Sq = result.vD2 ** 2 - 2 * g * L * slopeTerm;

    if (vP1Sq <= 0) {
      result.message = "我方无法上平台。";
      return result;
    }
    if (vP2Sq <= 0) {
      result.message = "对手无法上平台。";
      return result;
    }

    result.vP1 = Math.sqrt(vP1Sq);
    result.vP2 = Math.sqrt(vP2Sq);

    if (mu === 0) {
      result.tD1 = D / Math.max(result.v10, 1e-8);
      result.tD2 = D / Math.max(result.v20, 1e-8);
    } else {
      result.tD1 = (result.v10 - result.vD1) / (mu * g);
      result.tD2 = (result.v20 - result.vD2) / (mu * g);
    }

    const slopeAcc = g * slopeTerm;
    result.tL1 = (result.vD1 - result.vP1) / slopeAcc;
    result.tL2 = (result.vD2 - result.vP2) / slopeAcc;
    result.tarr1 = result.tD1 + result.tL1;
    result.tarr2 = result.tD2 + result.tL2;

    let xlead;
    if (result.tarr1 <= result.tarr2) {
      result.first_arrival = "我方先到";
      xlead = result.vP1 * (result.tarr2 - result.tarr1);
      if (xlead > S) {
        result.message = "两车未在平台上相遇。";
        return result;
      }
      const dt = (S - xlead) / (result.vP1 + result.vP2);
      result.xc = xlead + result.vP1 * dt;
    } else {
      result.first_arrival = "对手先到";
      xlead = result.vP2 * (result.tarr1 - result.tarr2);
      if (xlead > S) {
        result.message = "两车未在平台上相遇。";
        return result;
      }
      const dt = (S - xlead) / (result.vP1 + result.vP2);
      result.xc = S - (xlead + result.vP2 * dt);
    }

    result.xlead = xlead;
    result.x1c = result.xc - l1 / 2;
    result.x2c = result.xc + l2 / 2;

    const u1 = result.vP1;
    const u2 = -result.vP2;

    result.v1_after = (m1 * u1 + m2 * u2 - m2 * e * (u1 - u2)) / (m1 + m2);
    result.v2_after = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2);

    if (mup === 0) {
      result.message = "平台阻力系数 mu_p 不能为 0。";
      return result;
    }

    result.sstop1 = result.v1_after ** 2 / (2 * mup * g);
    result.sstop2 = result.v2_after ** 2 / (2 * mup * g);

    const d1Avail = result.xc - l1 / 2;
    const d2Avail = S - (result.xc + l2 / 2);
    result.d1_avail = d1Avail;
    result.d2_avail = d2Avail;

    const myStay = result.sstop1 < d1Avail;
    const enemyFall = result.sstop2 > d2Avail;

    result.A_flag = true;
    result.B_flag = true;
    result.C_flag = myStay && enemyFall;
    result.my_stay = myStay;
    result.enemy_fall = enemyFall;
    result.success = result.A_flag && result.B_flag && result.C_flag;

    if (result.success) {
      result.message = "成功：我方留在平台，对手被推出平台。";
    } else if (!enemyFall && myStay) {
      result.message = "失败：对手未被推出平台。";
    } else if (enemyFall && !myStay) {
      result.message = "失败：对手虽然掉台，但我方未留在平台。";
    } else if (!enemyFall && !myStay) {
      result.message = "失败：双方均未满足目标状态。";
    } else {
      result.message = "失败。";
    }

    return result;
  }

  function buildForm() {
    const root = $("#formRoot");
    if (!root) return;

    root.innerHTML = PARAM_SECTIONS.map((section) => {
      const fields = section.fields.map(([key, label, unit, step]) => `
        <div class="field">
          <label for="${key}">${label}${unit ? ` (${unit})` : ""}</label>
          <input id="${key}" name="${key}" data-key="${key}" type="number" inputmode="decimal" step="${step}" value="${DEFAULTS[key]}">
        </div>
      `).join("");

      return `
        <section class="input-group">
          <h2>${section.title}</h2>
          <div class="field-grid">${fields}</div>
        </section>
      `;
    }).join("");

    $$("[data-key]").forEach((input) => {
      inputMap[input.dataset.key] = input;
      input.addEventListener("input", () => handleInput(input.dataset.key));
    });
  }

  function buildMetrics() {
    const root = $("#metricsRoot");
    if (!root) return;
    root.innerHTML = METRICS.map(([key, label, unit]) => `
      <div class="metric">
        <span class="label">${label}${unit ? ` (${unit})` : ""}</span>
        <span id="metric-${key}" class="value">--</span>
      </div>
    `).join("");
  }

  function getParams() {
    const params = {};
    Object.keys(DEFAULTS).forEach((key) => {
      const raw = inputMap[key] ? inputMap[key].value : DEFAULTS[key];
      const value = Number(raw);
      params[key] = Number.isFinite(value) ? value : DEFAULTS[key];
    });
    return params;
  }

  function setInputValue(key, value) {
    if (!inputMap[key]) return;
    inputMap[key].value = Number.isFinite(value) ? Number(value.toFixed(6)) : value;
  }

  function updateL() {
    const autoL = $("#autoL");
    if (!autoL || !autoL.checked) {
      if (inputMap.L) inputMap.L.readOnly = false;
      return;
    }

    if (inputMap.L) inputMap.L.readOnly = true;
    const H = Number(inputMap.H.value);
    const alpha = Number(inputMap.alpha.value);
    if (H > 0 && alpha > 0 && alpha < 90) {
      setInputValue("L", H / Math.sin(rad(alpha)));
    }
  }

  function syncCars(sourceKey) {
    const sync = $("#syncCars");
    if (!sync || !sync.checked || !SYNC_MAP[sourceKey]) return;
    setInputValue(SYNC_MAP[sourceKey], Number(inputMap[sourceKey].value));
  }

  function handleInput(key) {
    if (key === "H" || key === "alpha") updateL();
    syncCars(key);
  }

  function resetDefaults() {
    Object.entries(DEFAULTS).forEach(([key, value]) => setInputValue(key, value));
    $("#syncCars").checked = true;
    $("#autoL").checked = true;
    updateL();
    clearResults("默认值已载入。");
  }

  function clearResults(message) {
    $("#statusBadge").className = "status-badge idle";
    $("#statusBadge").textContent = "待计算";
    $("#resultTitle").textContent = "等待输入";
    $("#resultMessage").textContent = message || "点击“计算”后查看是否满足目标。";
    METRICS.forEach(([key]) => {
      const node = $(`#metric-${key}`);
      if (node) node.textContent = "--";
    });
    renderFormulas(getParams(), null);
  }

  function renderMetrics(result) {
    METRICS.forEach(([key]) => {
      const node = $(`#metric-${key}`);
      if (!node) return;
      node.textContent = key in result ? fmt(result[key]) : "--";
    });
  }

  function renderStatus(result) {
    const badge = $("#statusBadge");
    const title = $("#resultTitle");
    const message = $("#resultMessage");
    if (!badge || !title || !message) return;

    if (result.success) {
      badge.className = "status-badge success";
      badge.textContent = "成功";
      title.textContent = "我方留台，对手掉台";
    } else if (result.message && result.message.includes("未找到")) {
      badge.className = "status-badge warning";
      badge.textContent = "未找到";
      title.textContent = "扫描范围内没有成功解";
    } else {
      badge.className = "status-badge failure";
      badge.textContent = "失败";
      title.textContent = "当前参数未达成目标";
    }

    message.textContent = result.message || "计算完成。";
  }

  function calculateAndRender() {
    updateL();
    const params = getParams();
    const result = calculateModel(params);
    renderStatus(result);
    renderMetrics(result);
    renderFormulas(params, result);
    return result;
  }

  function searchX1() {
    updateL();
    const params = getParams();
    let found = null;
    let bestResult = null;

    for (let i = 10; i <= 200; i += 1) {
      const x = i / 1000;
      params.x1 = x;
      const result = calculateModel(params);
      if (result.success) {
        found = x;
        bestResult = result;
        break;
      }
    }

    if (found === null) {
      const result = {
        success: false,
        message: "在扫描范围 0.01 ~ 0.20 m 内未找到成功解。"
      };
      renderStatus(result);
      renderMetrics(result);
      renderFormulas(getParams(), result);
      return result;
    }

    setInputValue("x1", found);
    renderStatus({
      ...bestResult,
      message: `${bestResult.message} 最小成功后拉距离 x1 ≈ ${fmt(found, 3)} m。`
    });
    renderMetrics(bestResult);
    renderFormulas(getParams(), bestResult);
    return bestResult;
  }

  function line(label, formula, substitution, resultText) {
    return `
      <div class="formula-row">
        <div class="formula-label">${label}</div>
        <div class="math-line">\\[${formula}\\]</div>
        <div class="math-line">\\[${substitution}\\]</div>
        <div class="text-result">${resultText}</div>
      </div>
    `;
  }

  function details(title, body, open = false) {
    return `
      <details class="formula-item"${open ? " open" : ""}>
        <summary><h3>${title}</h3></summary>
        <div class="formula-body">${body}</div>
      </details>
    `;
  }

  function renderFormulas(params, result) {
    const root = $("#formulaRoot");
    if (!root) return;

    const p = params || getParams();
    const r = result || {};
    const sinA = Math.sin(rad(p.alpha));
    const cosA = Math.cos(rad(p.alpha));
    const slopeTerm = sinA + p.mu * cosA;

    const sections = [
      details("1. 弹簧储能", [
        line("我方",
          "E_{s1}=\\frac{1}{2}k_1x_1^2",
          `E_{s1}=\\frac{1}{2}\\cdot ${mathNum(p.k1)}\\cdot ${mathNum(p.x1)}^2`,
          `E_s1 = ${fmt(r.Es1)} J`
        ),
        line("对手",
          "E_{s2}=\\frac{1}{2}k_2x_2^2",
          `E_{s2}=\\frac{1}{2}\\cdot ${mathNum(p.k2)}\\cdot ${mathNum(p.x2)}^2`,
          `E_s2 = ${fmt(r.Es2)} J`
        )
      ].join("")),
      details("2. 初速度", [
        line("我方",
          "v_{10}=x_1\\sqrt{\\frac{\\eta_1k_1}{m_1}}",
          `v_{10}=${mathNum(p.x1)}\\sqrt{\\frac{${mathNum(p.eta1)}\\cdot ${mathNum(p.k1)}}{${mathNum(p.m1)}}}`,
          `v10 = ${fmt(r.v10)} m/s`
        ),
        line("对手",
          "v_{20}=x_2\\sqrt{\\frac{\\eta_2k_2}{m_2}}",
          `v_{20}=${mathNum(p.x2)}\\sqrt{\\frac{${mathNum(p.eta2)}\\cdot ${mathNum(p.k2)}}{${mathNum(p.m2)}}}`,
          `v20 = ${fmt(r.v20)} m/s`
        )
      ].join("")),
      details("3. 平直段速度", [
        line("我方",
          "v_{D1}^2=v_{10}^2-2\\mu gD",
          `v_{D1}^2=${mathNum(r.v10)}^2-2\\cdot ${mathNum(p.mu)}\\cdot ${mathNum(p.g)}\\cdot ${mathNum(p.D)}`,
          `vD1 = ${fmt(r.vD1)} m/s`
        ),
        line("对手",
          "v_{D2}^2=v_{20}^2-2\\mu gD",
          `v_{D2}^2=${mathNum(r.v20)}^2-2\\cdot ${mathNum(p.mu)}\\cdot ${mathNum(p.g)}\\cdot ${mathNum(p.D)}`,
          `vD2 = ${fmt(r.vD2)} m/s`
        )
      ].join("")),
      details("4. 坡道段速度", [
        line("坡道长度",
          "L=\\frac{H}{\\sin\\alpha}",
          `L=\\frac{${mathNum(p.H)}}{\\sin(${mathNum(p.alpha)}^\\circ)}`,
          `L = ${fmt(p.L)} m`
        ),
        line("我方",
          "v_{P1}^2=v_{D1}^2-2gL(\\sin\\alpha+\\mu\\cos\\alpha)",
          `v_{P1}^2=${mathNum(r.vD1)}^2-2\\cdot ${mathNum(p.g)}\\cdot ${mathNum(p.L)}\\cdot (${mathNum(sinA)}+${mathNum(p.mu)}\\cdot ${mathNum(cosA)})`,
          `vP1 = ${fmt(r.vP1)} m/s`
        ),
        line("对手",
          "v_{P2}^2=v_{D2}^2-2gL(\\sin\\alpha+\\mu\\cos\\alpha)",
          `v_{P2}^2=${mathNum(r.vD2)}^2-2\\cdot ${mathNum(p.g)}\\cdot ${mathNum(p.L)}\\cdot (${mathNum(sinA)}+${mathNum(p.mu)}\\cdot ${mathNum(cosA)})`,
          `vP2 = ${fmt(r.vP2)} m/s`
        )
      ].join("")),
      details("5. 到达时间", [
        line("平直段",
          "t_D=\\frac{v_0-v_D}{\\mu g}",
          `t_{D1}=\\frac{${mathNum(r.v10)}-${mathNum(r.vD1)}}{${mathNum(p.mu)}\\cdot ${mathNum(p.g)}}`,
          `tD1 = ${fmt(r.tD1)} s，tD2 = ${fmt(r.tD2)} s`
        ),
        line("坡道段",
          "t_L=\\frac{v_D-v_P}{g(\\sin\\alpha+\\mu\\cos\\alpha)}",
          `t_{L1}=\\frac{${mathNum(r.vD1)}-${mathNum(r.vP1)}}{${mathNum(p.g)}\\cdot ${mathNum(slopeTerm)}}`,
          `tL1 = ${fmt(r.tL1)} s，tL2 = ${fmt(r.tL2)} s`
        ),
        line("到达平台",
          "t_{arr}=t_D+t_L",
          `t_{arr1}=${mathNum(r.tD1)}+${mathNum(r.tL1)}`,
          `tarr1 = ${fmt(r.tarr1)} s，tarr2 = ${fmt(r.tarr2)} s`
        )
      ].join("")),
      details("6. 平台相遇位置", [
        line("领先距离",
          "x_{lead}=v_P\\Delta t",
          `x_{lead}=${r.first_arrival === "对手先到" ? "v_{P2}" : "v_{P1}"}\\cdot |t_{arr2}-t_{arr1}|`,
          `${r.first_arrival || "--"}，xlead = ${fmt(r.xlead)} m`
        ),
        line("碰撞点",
          "x_c=x_{lead}+v_{P1}\\frac{S-x_{lead}}{v_{P1}+v_{P2}}",
          `x_c=${mathNum(r.xlead)}+${mathNum(r.vP1)}\\cdot\\frac{${mathNum(p.S)}-${mathNum(r.xlead)}}{${mathNum(r.vP1)}+${mathNum(r.vP2)}}`,
          `xc = ${fmt(r.xc)} m`
        )
      ].join("")),
      details("7. 碰撞后速度", [
        line("我方",
          "v'_1=\\frac{m_1u_1+m_2u_2-m_2e(u_1-u_2)}{m_1+m_2}",
          `v'_1=\\frac{${mathNum(p.m1)}\\cdot ${mathNum(r.vP1)}+${mathNum(p.m2)}\\cdot(-${mathNum(r.vP2)})-${mathNum(p.m2)}\\cdot ${mathNum(p.e)}\\cdot(${mathNum(r.vP1)}+${mathNum(r.vP2)})}{${mathNum(p.m1)}+${mathNum(p.m2)}}`,
          `v1_after = ${fmt(r.v1_after)} m/s`
        ),
        line("对手",
          "v'_2=\\frac{m_1u_1+m_2u_2+m_1e(u_1-u_2)}{m_1+m_2}",
          `v'_2=\\frac{${mathNum(p.m1)}\\cdot ${mathNum(r.vP1)}+${mathNum(p.m2)}\\cdot(-${mathNum(r.vP2)})+${mathNum(p.m1)}\\cdot ${mathNum(p.e)}\\cdot(${mathNum(r.vP1)}+${mathNum(r.vP2)})}{${mathNum(p.m1)}+${mathNum(p.m2)}}`,
          `v2_after = ${fmt(r.v2_after)} m/s`
        )
      ].join("")),
      details("8. 停止距离与胜负条件", [
        line("停止距离",
          "s_{stop}=\\frac{{v'}^2}{2\\mu_pg}",
          `s_{stop1}=\\frac{${mathNum(r.v1_after)}^2}{2\\cdot ${mathNum(p.mup)}\\cdot ${mathNum(p.g)}}`,
          `sstop1 = ${fmt(r.sstop1)} m，sstop2 = ${fmt(r.sstop2)} m`
        ),
        line("可用距离",
          "d_1=x_c-\\frac{l_1}{2},\\quad d_2=S-(x_c+\\frac{l_2}{2})",
          `d_1=${mathNum(r.xc)}-\\frac{${mathNum(p.l1)}}{2},\\quad d_2=${mathNum(p.S)}-(${mathNum(r.xc)}+\\frac{${mathNum(p.l2)}}{2})`,
          `d1 = ${fmt(r.d1_avail)} m，d2 = ${fmt(r.d2_avail)} m`
        ),
        line("目标判断",
          "s_{stop1}<d_1\\quad \\land \\quad s_{stop2}>d_2",
          `${mathNum(r.sstop1)}<${mathNum(r.d1_avail)}\\quad \\land \\quad ${mathNum(r.sstop2)}>${mathNum(r.d2_avail)}`,
          r.message || "--"
        )
      ].join(""))
    ];

    root.innerHTML = sections.join("");
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([root]).catch(() => {});
    }
  }

  function bindActions() {
    $$("[data-action='calculate']").forEach((button) => {
      button.addEventListener("click", calculateAndRender);
    });
    $$("[data-action='search']").forEach((button) => {
      button.addEventListener("click", searchX1);
    });
    $$("[data-action='reset']").forEach((button) => {
      button.addEventListener("click", resetDefaults);
    });
    $$("[data-action='theme']").forEach((button) => {
      button.addEventListener("click", () => {
        const root = document.documentElement;
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        button.textContent = next === "dark" ? "浅色" : "深色";
      });
    });

    $("#syncCars").addEventListener("change", () => {
      Object.keys(SYNC_MAP).forEach(syncCars);
    });
    $("#autoL").addEventListener("change", updateL);
  }

  function init() {
    buildForm();
    buildMetrics();
    bindActions();
    resetDefaults();
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("DOMContentLoaded", init);
    window.EngineerModel = { DEFAULTS, calculateModel };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { DEFAULTS, calculateModel };
  }
})();
