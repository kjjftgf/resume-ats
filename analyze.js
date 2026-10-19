// 简历 ATS 匹配检测 — 核心算法 + 页面逻辑（算法部分可在 node 中单测）
(function (root) {
  "use strict";

  var KEYWORD_GROUPS = (typeof require === "function" && typeof module !== "undefined")
    ? require("./keywords.js").KEYWORD_GROUPS
    : (root.KEYWORD_GROUPS || {});
  var WEAK_VERBS = ["负责", "参与", "协助", "配合", "跟进", "处理", "接触", "了解"];
  var STRONG_VERBS = ["主导", "搭建", "推动", "优化", "提升", "降低", "设计", "落地", "统筹", "策划", "重构", "从0到1", "带领", "独立"];

  // 展平词库（去重）
  var DICT = (function () {
    var set = {};
    Object.keys(KEYWORD_GROUPS).forEach(function (g) {
      KEYWORD_GROUPS[g].forEach(function (t) { set[t.toLowerCase()] = t; });
    });
    return Object.keys(set).map(function (k) { return set[k]; });
  })();

  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ");
  }

  // 从 JD 里提取关键词：词库命中 + 英文技术词
  function extractJdKeywords(jd) {
    var text = norm(jd);
    var hits = [];
    var seen = {};
    DICT.forEach(function (term) {
      var t = term.toLowerCase();
      if (text.indexOf(t) >= 0 && !seen[t]) {
        seen[t] = 1;
        hits.push(term);
      }
    });
    // 英文技术词（2-20 字符，字母开头）
    var re = /[a-z][a-z0-9+#./-]{1,19}/g;
    var m;
    var stop = { "and": 1, "the": 1, "with": 1, "for": 1, "our": 1, "you": 1, "we": 1, "team": 1, "work": 1, "job": 1, "year": 1, "years": 1, "able": 1 };
    while ((m = re.exec(text)) !== null) {
      var w = m[0];
      if (stop[w] || seen[w]) continue;
      // 已被中文关键词包含的英文片段（如 A/B测试 里的 a/b）不单独计
      var covered = DICT.some(function (term) {
        return term.toLowerCase().indexOf(w) >= 0;
      });
      if (covered) continue;
      seen[w] = 1;
      hits.push(w);
    }
    return hits;
  }

  function countMatches(text, terms) {
    var t = norm(text);
    var found = [];
    terms.forEach(function (term) {
      if (t.indexOf(term.toLowerCase()) >= 0) found.push(term);
    });
    return found;
  }

  // 量化结果：数字 + 单位，或含百分号
  function quantCount(text) {
    var re = /(\d+(?:\.\d+)?)\s*(%|％|万|亿|千|k|K|人|名|个|次|单|天|小时|元|块|倍|条|篇|场|家|台)/g;
    var m, n = 0;
    var seen = {};
    while ((m = re.exec(text)) !== null) {
      var key = m.index + ":" + m[1] + m[2];
      if (!seen[key]) { seen[key] = 1; n++; }
    }
    return n;
  }

  function hasContact(text) {
    return /1[3-9]\d{9}/.test(text) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || /微信|linkedin|领英/i.test(text);
  }

  function analyze(resume, jd) {
    var r = String(resume || "");
    var j = String(jd || "");
    var result = {
      score: 0, coverage: 0, matched: [], missing: [],
      checks: [], stats: {}
    };
    if (!r.trim()) {
      result.checks.push({ level: "error", title: "简历内容为空", desc: "把简历正文粘贴进来（不含图片）。" });
      return result;
    }
    if (!j.trim()) {
      // 无 JD 时只做体检
      result.checks = resumeChecks(r);
      result.score = null;
      return result;
    }

    var jdKeywords = extractJdKeywords(j);
    var matched = countMatches(r, jdKeywords);
    var missing = jdKeywords.filter(function (k) {
      return matched.indexOf(k) < 0;
    });
    var coverage = jdKeywords.length ? matched.length / jdKeywords.length : 0.6;

    result.matched = matched;
    result.missing = missing;
    result.coverage = Math.round(coverage * 100);
    result.stats.jdKeywords = jdKeywords.length;
    result.stats.matched = matched.length;

    result.checks = resumeChecks(r);

    // 评分：关键词 70 + 量化 15 + 弱动词 15
    var base = coverage * 70;
    var qc = quantCount(r);
    var quant = Math.min(15, qc * 5);
    var weak = countMatches(r, WEAK_VERBS).length;
    var weakScore = Math.max(0, 15 - weak * 3);
    var total = Math.round(base + quant + weakScore);
    result.score = Math.max(0, Math.min(100, total));
    result.stats.quant = qc;
    result.stats.weakVerbs = weak;
    return result;
  }

  function resumeChecks(r) {
    var checks = [];
    var len = r.replace(/\s/g, "").length;

    if (!hasContact(r)) {
      checks.push({ level: "error", title: "没找到联系方式", desc: "手机号或邮箱缺失，HR 想联系你也找不到。" });
    }
    if (len < 300) {
      checks.push({ level: "warn", title: "内容过短（约 " + len + " 字）", desc: "简历信息量不足，至少写满一页。" });
    } else if (len > 1600) {
      checks.push({ level: "warn", title: "内容偏长（约 " + len + " 字）", desc: "超过 2 页通常会被直接筛掉，删掉与岗位无关的内容。" });
    }

    var weak = countMatches(r, WEAK_VERBS).length;
    if (weak >= 4) {
      checks.push({ level: "warn", title: "弱动词过多（" + weak + " 处）", desc: "「负责/参与/协助」说明不了你的贡献，改成动作 + 结果。" });
    }
    var strong = countMatches(r, STRONG_VERBS).length;
    if (strong === 0) {
      checks.push({ level: "warn", title: "没有强动词", desc: "用「主导/搭建/推动/优化/从 0 到 1」这类词，体现你的作用。" });
    }

    var qc = quantCount(r);
    if (qc < 3) {
      checks.push({ level: "warn", title: "量化结果不足（" + qc + " 处）", desc: "至少写 3 处数字：提升多少%、覆盖多少人、节省多少时间或成本。" });
    } else {
      checks.push({ level: "ok", title: "量化结果 " + qc + " 处", desc: "数字是简历里最容易被记住的部分。" });
    }

    if (!/项目|经历|实习|工作/.test(r)) {
      checks.push({ level: "warn", title: "没看到经历板块", desc: "简历至少要有教育背景 + 经历两块。" });
    }
    if (checks.length === 0) {
      checks.push({ level: "ok", title: "基础体检通过", desc: "结构、联系方式、量化都正常。" });
    }
    return checks;
  }

  var api = { analyze: analyze, extractJdKeywords: extractJdKeywords, quantCount: quantCount, DICT: DICT };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.ResumeATS = api;
})(typeof window !== "undefined" ? window : globalThis);
