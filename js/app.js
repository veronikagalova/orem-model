(function () {
  'use strict';

  var PERIODS = [
    { short: 'П1', label: '01.01–30.09.2026', from: 0, to: 8 },
    { short: 'П2', label: '01.10–31.12.2026', from: 9, to: 11 },
  ];
  function periodOf(m) {
    return m <= PERIODS[0].to ? 0 : 1;
  }

  var DIRECTORY = (function () {
    var map = {},
      order = [];
    GP_TABLE.forEach(function (row) {
      var reg = row[0];
      if (!map[reg]) {
        map[reg] = { region: reg, suppliers: [] };
        order.push(reg);
      }
      map[reg].suppliers.push({ name: row[1], k: [row.slice(2, 5), row.slice(5, 8)] });
    });
    order.sort(function (a, b) {
      return a.localeCompare(b, 'ru');
    });
    return order.map(function (r) {
      return map[r];
    });
  })();

  var POWER_CLASSES = [
    {
      label: 'менее 670 кВт',
      match: function (p) {
        return p < 670;
      },
    },
    {
      label: 'от 670 кВт до 10 МВт',
      match: function (p) {
        return p >= 670 && p < 10000;
      },
    },
    {
      label: 'не менее 10 МВт',
      match: function (p) {
        return p >= 10000;
      },
    },
  ];

  var MONTHS = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var VOL_UNIT = 'кВт·ч';
  var STORE_KEY = 'orem-model';

  // Состояние
  var seq = 0;
  function blankPoint() {
    return { id: ++seq, name: '', region: '', supplier: '', power: '', vol: new Array(12).fill('') };
  }
  function defaultModel() {
    return {
      points: [blankPoint()],
      staff: [
        { title: 'Технический специалист', rate: 75000, qty: 0 },
        { title: 'Юрист', rate: 85000, qty: 0 },
        { title: 'Аналитик рынка', rate: 105000, qty: 0 },
        { title: 'Менеджер по закупкам', rate: 75000, qty: 0 },
      ],
      other: 0,
      oneOff: { rate: 825000, qty: 4 },
    };
  }
  var model = defaultModel();

  // Утилиты
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(
      String(v == null ? '' : v)
        .replace(/[\s ]/g, '')
        .replace(',', '.'),
    );
    return isFinite(n) ? n : 0;
  }
  var nfMoney = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfQty = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  var nfK = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
  var nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  var nfPct = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function rub(v) {
    return nfMoney.format(v) + ' ₽';
  }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' млрд';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' млн';
    if (a >= 1e3) return Math.round(v / 1e3) + ' тыс';
    return String(Math.round(v));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function icon(id) {
    return '<svg class="i"><use href="#ic-' + id + '"/></svg>';
  }
  function findRegion(name) {
    for (var i = 0; i < DIRECTORY.length; i++) if (DIRECTORY[i].region === name) return DIRECTORY[i];
    return null;
  }
  // в карточке ГТП выбирается один из двух классов мощности (индексы 1 и 2 в POWER_CLASSES)
  var POWER_CHOICES = [1, 2];
  function powerClass(p) {
    var i = parseInt(p, 10);
    return POWER_CHOICES.indexOf(i) >= 0 ? i : -1;
  }
  function pointById(id) {
    for (var i = 0; i < model.points.length; i++) if (model.points[i].id === id) return model.points[i];
    return null;
  }

  // Расчёт
  function evalPoint(pt) {
    var reg = findRegion(pt.region);
    var sup = null;
    if (reg)
      reg.suppliers.forEach(function (s) {
        if (s.name === pt.supplier) sup = s;
      });
    var cls = powerClass(pt.power);
    var ks = sup && cls >= 0 ? [sup.k[0][cls], sup.k[1][cls]] : null;
    var monthly = pt.vol.map(num);
    var volume = monthly.reduce(function (a, b) {
      return a + b;
    }, 0);
    var pVol = [0, 0],
      pSave = [0, 0];
    var monthlySaving = monthly.map(function (w, m) {
      var p = periodOf(m);
      pVol[p] += w;
      var v = ks ? w * ks[p] : 0;
      pSave[p] += v;
      return v;
    });
    return {
      cls: cls,
      ks: ks,
      volume: volume,
      pVol: pVol,
      pSave: pSave,
      growth: ks && ks[0] > 0 ? (ks[1] / ks[0] - 1) * 100 : null,
      monthlySaving: monthlySaving,
      saving: pSave[0] + pSave[1],
    };
  }

  function evaluate() {
    var perPoint = model.points.map(evalPoint);
    var monthSaving = new Array(12).fill(0);
    perPoint.forEach(function (r) {
      r.monthlySaving.forEach(function (v, m) {
        monthSaving[m] += v;
      });
    });
    var saving = perPoint.reduce(function (a, r) {
      return a + r.saving;
    }, 0);
    var staffMonthly = model.staff.reduce(function (a, s) {
      return a + num(s.rate) * num(s.qty);
    }, 0);
    var opsMonthly = staffMonthly + num(model.other);
    var oneOff = num(model.oneOff.rate) * num(model.oneOff.qty);
    var cost = opsMonthly * 12 + oneOff;
    return {
      perPoint: perPoint,
      monthSaving: monthSaving,
      saving: saving,
      opsMonthly: opsMonthly,
      oneOff: oneOff,
      cost: cost,
      effect: saving - cost,
      efficiency: cost > 0 ? (saving / cost) * 100 : 0,
      payback: payback(monthSaving, opsMonthly, oneOff),
    };
  }

  // Срок окупаемости в месяцах (дробный) или null, если выход не окупается
  function payback(monthSaving, opsMonthly, oneOff) {
    var cs = 0,
      cc = oneOff,
      totalS = 0;
    monthSaving.forEach(function (v) {
      totalS += v;
    });
    if (totalS <= 0) return null;
    for (var m = 0; m < 12; m++) {
      var gap0 = cc - cs;
      cs += monthSaving[m];
      cc += opsMonthly;
      var gap1 = cc - cs;
      if (gap1 <= 0) return gap0 <= 0 ? m : m + gap0 / (gap0 - gap1);
    }
    var netPerMonth = totalS / 12 - opsMonthly;
    return netPerMonth > 0 ? 12 + (cc - cs) / netPerMonth : null;
  }

  // Карточки ГТП
  var list = $('#gtpList');

  function pointHTML(pt) {
    var blocks = PERIODS.map(function (per, p) {
      var rows = '';
      for (var m = per.from; m <= per.to; m++) {
        var fid = 'v' + pt.id + '-' + m;
        rows +=
          '<div class="month"><label for="' +
          fid +
          '">' +
          MONTHS[m] +
          '</label>' +
          '<input id="' +
          fid +
          '" type="number" inputmode="decimal" min="0" step="any" placeholder="0" data-month="' +
          m +
          '" value="' +
          esc(pt.vol[m]) +
          '"></div>';
      }
      return (
        '<div class="period' +
        (p ? ' second' : '') +
        '">' +
        '<div class="period-head"><div><b>' +
        PERIODS[p].short +
        ' · ' +
        MONTHS[per.from].toLowerCase() +
        ' – ' +
        MONTHS[per.to].toLowerCase() +
        '</b>' +
        '<span class="period-dates">' +
        per.label +
        ' · <span class="period-k" data-pk="' +
        p +
        '">k не выбран</span></span></div>' +
        '<div class="period-sum"><span data-pv="' +
        p +
        '">0</span><b data-ps="' +
        p +
        '">0 ₽</b></div></div>' +
        '<div class="months">' +
        rows +
        '</div></div>'
      );
    }).join('');
    return (
      '' +
      '<article class="box gtp" data-id="' +
      pt.id +
      '">' +
      '<div class="gtp-head">' +
      '<span class="gtp-num" data-out="badge"></span>' +
      '<input class="gtp-name" data-key="name" placeholder="Название ГТП (необязательно)" value="' +
      esc(pt.name) +
      '" aria-label="Название ГТП">' +
      '<button class="icon-btn" type="button" data-act="clone" title="Дублировать ГТП">' +
      icon('copy') +
      '</button>' +
      '<button class="icon-btn delete" type="button" data-act="drop" title="Удалить ГТП">' +
      icon('trash') +
      '</button>' +
      '</div>' +
      '<div class="params">' +
      '<div class="field-wrap"><span class="field-name">Регион</span>' +
      '<div class="region"><input class="field" data-combo="region" autocomplete="off" placeholder="Начните вводить регион" value="' +
      esc(pt.region) +
      '" role="combobox" aria-expanded="false" aria-autocomplete="list">' +
      '<ul class="region-list" role="listbox" hidden></ul></div></div>' +
      '<label class="field-wrap"><span class="field-name">Гарантирующий поставщик</span><select class="field" data-key="supplier"></select></label>' +
      '<label class="field-wrap"><span class="field-name">Мощность ЭПУ</span>' +
      '<select class="field" data-key="power"><option value="">Выберите мощность</option>' +
      POWER_CHOICES.map(function (c) {
        return (
          '<option value="' +
          c +
          '"' +
          (String(pt.power) === String(c) ? ' selected' : '') +
          '>' +
          POWER_CLASSES[c].label +
          '</option>'
        );
      }).join('') +
      '</select></label>' +
      '</div>' +
      '<div class="supplier-info" data-out="coef"></div>' +
      '<p class="volume-hint">Введите месячный объём потребления электроэнергии по ГТП, кВт·ч</p>' +
      '<div class="periods">' +
      blocks +
      '</div>' +
      '<div class="fill-row">' +
      '<span>Все месяцы =</span><input type="number" min="0" step="any" data-fill placeholder="значение" aria-label="Значение для всех месяцев">' +
      '<button class="small-btn" type="button" data-act="fill">Заполнить</button>' +
      '<button class="small-btn" type="button" data-act="clear">Очистить</button>' +
      '</div>' +
      '<div class="gtp-total"><div><span>Потребление за год, ' +
      VOL_UNIT +
      '</span><b data-out="vol">0</b></div>' +
      '<div><span>Экономия</span><b data-out="save">0</b></div></div>' +
      '</article>'
    );
  }

  function fillSuppliers(card, pt) {
    var sel = $('select[data-key="supplier"]', card);
    var reg = findRegion(pt.region);
    if (!reg) {
      sel.innerHTML = '<option value="">Сначала выберите регион</option>';
      sel.disabled = true;
      pt.supplier = '';
      return;
    }
    sel.disabled = false;
    var names = reg.suppliers.map(function (s) {
      return s.name;
    });
    if (names.indexOf(pt.supplier) < 0) pt.supplier = names.length === 1 ? names[0] : '';
    sel.innerHTML =
      '<option value="">Выберите поставщика</option>' +
      names
        .map(function (n) {
          return (
            '<option' +
            (n === pt.supplier ? ' selected' : '') +
            ' value="' +
            esc(n) +
            '">' +
            esc(n) +
            '</option>'
          );
        })
        .join('');
  }

  function renderPoints() {
    list.innerHTML = model.points.map(pointHTML).join('');
    model.points.forEach(function (pt) {
      fillSuppliers(list.querySelector('[data-id="' + pt.id + '"]'), pt);
    });
    refresh();
  }

  function appendPoint(pt) {
    list.insertAdjacentHTML('beforeend', pointHTML(pt));
    var card = list.lastElementChild;
    fillSuppliers(card, pt);
    refresh();
    return card;
  }

  // Выпадающий список регионов
  var combo = { input: null, items: [], active: -1 };

  function openCombo(input) {
    combo.input = input;
    var q = input.value.trim().toLowerCase();
    var ul = input.nextElementSibling;
    var regions = DIRECTORY.map(function (d) {
      return d.region;
    });
    var hit =
      q && findRegion(input.value)
        ? regions
        : regions.filter(function (r) {
            return r.toLowerCase().indexOf(q) >= 0;
          });
    combo.items = hit;
    combo.active = hit.length ? 0 : -1;
    ul.innerHTML = hit.length
      ? hit
          .map(function (r, i) {
            var label = esc(r);
            if (q && !findRegion(input.value)) {
              var at = r.toLowerCase().indexOf(q);
              label =
                esc(r.slice(0, at)) +
                '<mark>' +
                esc(r.slice(at, at + q.length)) +
                '</mark>' +
                esc(r.slice(at + q.length));
            }
            return (
              '<li role="option" data-i="' + i + '" aria-selected="' + (i === 0) + '">' + label + '</li>'
            );
          })
          .join('')
      : '<li class="empty">Регион не найден в справочнике</li>';
    ul.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function closeCombo() {
    if (!combo.input) return;
    combo.input.nextElementSibling.hidden = true;
    combo.input.setAttribute('aria-expanded', 'false');
    combo.input = null;
  }
  function moveCombo(d) {
    if (!combo.items.length) return;
    combo.active = (combo.active + d + combo.items.length) % combo.items.length;
    var lis = combo.input.nextElementSibling.querySelectorAll('li');
    lis.forEach(function (li, i) {
      li.setAttribute('aria-selected', String(i === combo.active));
    });
    lis[combo.active].scrollIntoView({ block: 'nearest' });
  }
  function pickRegion(input, name) {
    var card = input.closest('.gtp');
    var pt = pointById(+card.dataset.id);
    input.value = name;
    if (pt.region !== name) {
      pt.region = name;
      fillSuppliers(card, pt);
    }
    closeCombo();
    refresh();
    var sel = $('select[data-key="supplier"]', card);
    if (!pt.supplier) sel.focus();
    else $('[data-key="power"]', card).focus();
  }

  // События
  list.addEventListener('focusin', function (e) {
    if (e.target.matches('[data-combo]')) {
      e.target.select();
      openCombo(e.target);
    }
  });
  list.addEventListener('focusout', function (e) {
    if (!e.target.matches('[data-combo]')) return;
    var input = e.target;
    setTimeout(function () {
      if (combo.input === input) closeCombo();
      var pt = pointById(+input.closest('.gtp').dataset.id);
      var exact = DIRECTORY.filter(function (d) {
        return d.region.toLowerCase() === input.value.trim().toLowerCase();
      })[0];
      if (exact) {
        if (pt.region !== exact.region) pickRegion(input, exact.region);
        else input.value = exact.region;
      } else input.value = pt.region;
    }, 150);
  });
  list.addEventListener('mousedown', function (e) {
    var li = e.target.closest('.region-list li[data-i]');
    if (!li) return;
    e.preventDefault();
    pickRegion(combo.input, combo.items[+li.dataset.i]);
  });
  list.addEventListener('keydown', function (e) {
    if (!e.target.matches('[data-combo]')) return;
    if (combo.input !== e.target) openCombo(e.target);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCombo(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCombo(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (combo.active >= 0) pickRegion(e.target, combo.items[combo.active]);
    } else if (e.key === 'Escape') closeCombo();
  });

  list.addEventListener('input', function (e) {
    var t = e.target,
      card = t.closest('.gtp');
    if (!card) return;
    var pt = pointById(+card.dataset.id);
    if (t.matches('[data-combo]')) {
      openCombo(t);
      return;
    }
    if (t.dataset.month != null) pt.vol[+t.dataset.month] = t.value;
    else if (t.dataset.key) pt[t.dataset.key] = t.value;
    else return;
    refresh();
  });
  list.addEventListener('change', function (e) {
    var t = e.target,
      card = t.closest('.gtp');
    if (card && t.matches('select[data-key]')) {
      pointById(+card.dataset.id)[t.dataset.key] = t.value;
      refresh();
    }
  });

  // Вставка столбца/строки чисел из Excel — раскладываем по месяцам
  list.addEventListener('paste', function (e) {
    var t = e.target;
    if (t.dataset.month == null) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    var parts = text
      .split(/[\t\r\n;]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    var card = t.closest('.gtp'),
      pt = pointById(+card.dataset.id);
    var start = +t.dataset.month,
      n = 0;
    parts.forEach(function (p, i) {
      var m = start + i;
      if (m > 11) return;
      var v = num(p);
      pt.vol[m] = v ? String(v) : '';
      $('[data-month="' + m + '"]', card).value = pt.vol[m];
      n++;
    });
    refresh();
    toast('Вставлено значений: ' + n);
  });

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var card = b.closest('.gtp'),
      id = +card.dataset.id,
      pt = pointById(id);
    switch (b.dataset.act) {
      case 'drop':
        if (model.points.length < 2) return;
        model.points = model.points.filter(function (p) {
          return p.id !== id;
        });
        card.remove();
        refresh();
        break;
      case 'clone':
        var copy = JSON.parse(JSON.stringify(pt));
        copy.id = ++seq;
        copy.name = pt.name ? pt.name + ' (копия)' : '';
        model.points.splice(model.points.indexOf(pt) + 1, 0, copy);
        card.insertAdjacentHTML('afterend', pointHTML(copy));
        fillSuppliers(card.nextElementSibling, copy);
        refresh();
        break;
      case 'fill':
        var v = $('[data-fill]', card).value;
        if (v === '') {
          $('[data-fill]', card).focus();
          return;
        }
        pt.vol = new Array(12).fill(v);
        card.querySelectorAll('[data-month]').forEach(function (i) {
          i.value = v;
        });
        refresh();
        break;
      case 'clear':
        pt.vol = new Array(12).fill('');
        card.querySelectorAll('[data-month]').forEach(function (i) {
          i.value = '';
        });
        refresh();
        break;
    }
  });

  $('#btnAdd').addEventListener('click', function () {
    var pt = blankPoint();
    model.points.push(pt);
    var card = appendPoint(pt);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('[data-combo]', card).focus();
  });

  // Затраты
  var costBody = $('#costBody');
  function costGroup(n, title, key) {
    return '<tr class="group"><td colspan="5"><span>' + n + '</span>' + title + '</td></tr>';
  }
  function costSubtotal(key) {
    return (
      '<tr class="subtotal"><td colspan="4">Итого по разделу</td><td class="r money" data-sub="' +
      key +
      '"></td></tr>'
    );
  }
  function renderCosts() {
    var rows = [costGroup(1, 'Затраты на штат специалистов по работе на ОРЭМ')];
    model.staff.forEach(function (s, i) {
      rows.push(
        '<tr><td>' +
          esc(s.title) +
          '<span class="hint">оклад в месяц</span></td>' +
          '<td class="r"><input type="number" min="0" step="any" data-staff="' +
          i +
          '" data-f="rate" value="' +
          esc(s.rate) +
          '" aria-label="Зарплата"></td>' +
          '<td class="r"><input class="count" type="number" min="0" step="1" data-staff="' +
          i +
          '" data-f="qty" value="' +
          esc(s.qty || '') +
          '" placeholder="0" aria-label="Количество"></td>' +
          '<td class="r money" data-cm="' +
          i +
          '"></td><td class="r money" data-cy="' +
          i +
          '"></td></tr>',
      );
    });
    rows.push(costSubtotal('staff'));
    rows.push(costGroup(2, 'Затраты на инфраструктуру ОРЭМ'));
    rows.push(
      '<tr><td>Платежи на инфраструктуру<span class="hint">ставка × количество</span></td>' +
        '<td class="r"><input type="number" min="0" step="any" data-one="rate" value="' +
        esc(model.oneOff.rate) +
        '" aria-label="Размер платежа"></td>' +
        '<td class="r"><input class="count" type="number" min="0" step="1" data-one="qty" value="' +
        esc(model.oneOff.qty) +
        '" aria-label="Количество платежей"></td>' +
        '<td class="r money">—</td><td class="r money" data-cy="one"></td></tr>',
    );
    rows.push(costSubtotal('infra'));
    rows.push(costGroup(3, 'Прочие затраты'));
    rows.push(
      '<tr><td>Прочие расходы<span class="hint">в месяц</span></td>' +
        '<td class="r"><input type="number" min="0" step="any" data-other value="' +
        esc(model.other || '') +
        '" placeholder="0" aria-label="Прочие расходы в месяц"></td>' +
        '<td class="r">—</td><td class="r money" data-cm="o"></td><td class="r money" data-cy="o"></td></tr>',
    );
    rows.push(costSubtotal('other'));
    costBody.innerHTML = rows.join('');
  }
  costBody.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.staff != null) model.staff[+t.dataset.staff][t.dataset.f] = t.value;
    else if (t.hasAttribute('data-other')) model.other = t.value;
    else if (t.dataset.one) model.oneOff[t.dataset.one] = t.value;
    refresh();
  });

  // График
  var CSS_PAL = {
    line: 'var(--border)',
    main: 'var(--violet)',
    neg: 'var(--red)',
    light: 'var(--violet-light)',
    mainDark: 'var(--violet)',
    surface: 'var(--white)',
    text: '',
  };
  var PDF_PAL = {
    line: '#e3ded3',
    main: '#5b3fd0',
    neg: '#c23a3a',
    light: '#7b5cf0',
    mainDark: '#5b3fd0',
    surface: '#ffffff',
    text: 'font-family:JetBrains Mono,monospace;font-size:12px;fill:#6e6a75;',
  };
  function drawChart(r) {
    $('#chart').innerHTML = chartMarkup(r, CSS_PAL);
  }
  function chartMarkup(r, P) {
    var W = 600,
      H = 260,
      L = 68,
      R = 14,
      T = 22,
      B = 30;
    var cs = [0],
      cc = [r.oneOff];
    for (var m = 0; m < 12; m++) {
      cs.push(cs[m] + r.monthSaving[m]);
      cc.push(cc[m] + r.opsMonthly);
    }
    var top = Math.max.apply(null, cs.concat(cc, [1])) * 1.08;
    function x(i) {
      return L + ((W - L - R) * i) / 12;
    }
    function y(v) {
      return T + (H - T - B) * (1 - v / top);
    }
    var out = [];
    for (var g = 0; g <= 4; g++) {
      var gv = ((top / 1.08) * g) / 4,
        gy = y(gv).toFixed(1);
      out.push(
        '<line x1="' +
          L +
          '" x2="' +
          (W - R) +
          '" y1="' +
          gy +
          '" y2="' +
          gy +
          '" stroke="' +
          P.line +
          '" stroke-dasharray="' +
          (g ? '3 4' : '0') +
          '"/>',
      );
      out.push(
        '<text x="' +
          (L - 8) +
          '" y="' +
          (+gy + 3) +
          '" text-anchor="end" style="' +
          P.text +
          '">' +
          compact(gv) +
          '</text>',
      );
    }
    for (var i = 1; i <= 12; i++)
      out.push(
        '<text x="' +
          x(i - 0.5).toFixed(1) +
          '" y="' +
          (H - 10) +
          '" text-anchor="middle" style="' +
          P.text +
          '">' +
          MONTHS_SHORT[i - 1] +
          '</text>',
      );
    function line(arr) {
      return arr
        .map(function (v, i) {
          return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        })
        .join('');
    }
    out.push(
      '<path d="' +
        line(cs) +
        'L' +
        x(12) +
        ' ' +
        y(0) +
        'L' +
        x(0) +
        ' ' +
        y(0) +
        'Z" fill="' +
        P.main +
        '" opacity=".14"/>',
    );
    out.push(
      '<path d="' +
        line(cc) +
        '" fill="none" stroke="' +
        P.neg +
        '" stroke-width="2.2" stroke-dasharray="6 5"/>',
    );
    out.push('<path d="' + line(cs) + '" fill="none" stroke="' + P.main + '" stroke-width="2.6"/>');
    cs.forEach(function (v, i) {
      if (i)
        out.push(
          '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.6" fill="' + P.main + '"/>',
        );
    });
    if (r.payback != null && r.payback <= 12 && r.saving > 0) {
      var pm = r.payback,
        i0 = Math.floor(pm),
        f = pm - i0;
      var pv = i0 >= 12 ? cs[12] : cs[i0] + (cs[i0 + 1] - cs[i0]) * f;
      var px = x(pm),
        py = y(pv);
      out.push(
        '<line x1="' +
          px +
          '" x2="' +
          px +
          '" y1="' +
          T +
          '" y2="' +
          y(0) +
          '" stroke="' +
          P.light +
          '" stroke-width="1.5"/>',
      );
      out.push(
        '<circle cx="' +
          px +
          '" cy="' +
          py +
          '" r="6" fill="' +
          P.light +
          '" stroke="' +
          P.surface +
          '" stroke-width="2.5"/>',
      );
      var tx = px > W - 120 ? px - 8 : px + 8;
      out.push(
        '<text x="' +
          tx +
          '" y="' +
          (T + 10) +
          '" text-anchor="' +
          (px > W - 120 ? 'end' : 'start') +
          '" style="' +
          P.text +
          'fill:' +
          P.mainDark +
          ';font-weight:600">окупаемость ≈ ' +
          pm.toFixed(1).replace('.', ',') +
          ' мес.</text>',
      );
    }
    return out.join('');
  }

  // Аналитика темпа роста надбавок
  var an = { cls: 1, q: '', sort: 'desc' };
  var CLASS_SHORT = ['< 670 кВт', '670 кВт – 10 МВт', '≥ 10 МВт'];
  function growthOf(s, c) {
    return s.k[0][c] > 0 ? (s.k[1][c] / s.k[0][c] - 1) * 100 : null;
  }
  function mean(a) {
    return a.length
      ? a.reduce(function (x, y) {
          return x + y;
        }, 0) / a.length
      : null;
  }
  function median(a) {
    if (!a.length) return null;
    var b = a.slice().sort(function (x, y) {
        return x - y;
      }),
      h = b.length >> 1;
    return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2;
  }
  function pct(v) {
    return v == null ? '—' : (v > 0 ? '+' : '') + nfPct.format(v) + ' %';
  }

  function regionStats(c) {
    return DIRECTORY.map(function (d) {
      var gs = d.suppliers
        .map(function (s) {
          return growthOf(s, c);
        })
        .filter(function (v) {
          return v != null;
        });
      return { region: d.region, avg: mean(gs), d: d };
    });
  }

  function renderAnalytics() {
    $('#anClass').innerHTML = CLASS_SHORT.map(function (t, i) {
      return (
        '<button type="button" role="tab" data-c="' +
        i +
        '" aria-selected="' +
        (i === an.cls) +
        '">' +
        t +
        '</button>'
      );
    }).join('');
    var all = [];
    DIRECTORY.forEach(function (d) {
      d.suppliers.forEach(function (s) {
        var g = growthOf(s, an.cls);
        if (g != null) all.push(g);
      });
    });
    var up = all.filter(function (g) {
        return g > 0.05;
      }).length,
      down = all.filter(function (g) {
        return g < -0.05;
      }).length;
    var rs = regionStats(an.cls);
    $('#anKpis').innerHTML =
      '<div><span>Средний по РФ</span><b>' +
      pct(mean(all)) +
      '</b></div>' +
      '<div><span>Медиана по ГП</span><b>' +
      pct(median(all)) +
      '</b></div>' +
      '<div><span>Рост / снижение</span><b>' +
      up +
      ' / ' +
      down +
      '</b></div>' +
      '<div><span>Регионов · ГП</span><b>' +
      rs.length +
      ' · ' +
      all.length +
      '</b></div>';

    var used = {};
    model.points.forEach(function (p) {
      if (p.region) used[p.region] = true;
    });
    var q = an.q.trim().toLowerCase();
    var rows = rs.filter(function (r) {
      return !q || r.region.toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(
      an.sort === 'abc'
        ? function (a, b) {
            return a.region.localeCompare(b.region, 'ru');
          }
        : function (a, b) {
            return an.sort === 'desc' ? b.avg - a.avg : a.avg - b.avg;
          },
    );
    // шкала: обрезаем выбросы, чтобы остальные столбики были читаемыми
    var lo = Math.max(
        -100,
        Math.min(
          0,
          Math.min.apply(
            null,
            rs.map(function (r) {
              return r.avg;
            }),
          ),
        ),
      ),
      hi = Math.min(
        150,
        Math.max(
          10,
          Math.max.apply(
            null,
            rs.map(function (r) {
              return r.avg;
            }),
          ),
        ),
      );
    var span = hi - lo,
      zero = (-lo / span) * 100;
    $('#anList').innerHTML = rows.length
      ? rows
          .map(function (r) {
            var v = Math.max(lo, Math.min(hi, r.avg)),
              cut = v !== r.avg;
            var w = (Math.abs(v) / span) * 100,
              left = v >= 0 ? zero : zero - w;
            return (
              '<details><summary>' +
              '<span class="region-name">' +
              (used[r.region] ? '<i class="dot" title="Используется в расчёте"></i>' : '') +
              esc(r.region) +
              '<small>' +
              r.d.suppliers.length +
              ' ГП</small></span>' +
              '<span class="bar" style="--zero:' +
              zero.toFixed(2) +
              '%"><i class="' +
              (r.avg < 0 ? 'minus' : '') +
              (cut ? ' over' : '') +
              '" style="left:' +
              left.toFixed(2) +
              '%;width:' +
              Math.max(w, 0.6).toFixed(2) +
              '%"></i></span>' +
              '<span class="value' +
              (r.avg < 0 ? ' minus' : '') +
              '">' +
              pct(r.avg) +
              '</span></summary>' +
              '<ul class="suppliers">' +
              r.d.suppliers
                .map(function (s) {
                  return (
                    '<li><span>' +
                    esc(s.name) +
                    '</span><b>' +
                    nfK.format(s.k[0][an.cls]) +
                    ' → ' +
                    nfK.format(s.k[1][an.cls]) +
                    ' · ' +
                    pct(growthOf(s, an.cls)) +
                    '</b></li>'
                  );
                })
                .join('') +
              '</ul></details>'
            );
          })
          .join('')
      : '<p class="note">Регион не найден</p>';
  }
  $('#anClass').addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]');
    if (b) {
      an.cls = +b.dataset.c;
      renderAnalytics();
    }
  });
  $('#anSearch').addEventListener('input', function (e) {
    an.q = e.target.value;
    renderAnalytics();
  });
  $('#anSort').addEventListener('change', function (e) {
    an.sort = e.target.value;
    renderAnalytics();
  });
  $('#anCsv').addEventListener('click', function () {
    var f = function (v) {
      return v == null ? '' : v.toFixed(2).replace('.', ',');
    };
    var lines = [
      'Регион;ГП;' +
        CLASS_SHORT.map(function (c) {
          return 'П1 ' + c + ';П2 ' + c + ';Темп роста ' + c + ', %';
        }).join(';'),
    ];
    DIRECTORY.forEach(function (d) {
      d.suppliers.forEach(function (s) {
        lines.push(
          '"' +
            d.region +
            '";"' +
            s.name.replace(/"/g, '""') +
            '";' +
            [0, 1, 2]
              .map(function (c) {
                return (
                  String(s.k[0][c]).replace('.', ',') +
                  ';' +
                  String(s.k[1][c]).replace('.', ',') +
                  ';' +
                  f(growthOf(s, c))
                );
              })
              .join(';'),
        );
      });
    });
    var rsAll = [0, 1, 2].map(regionStats);
    lines.push('');
    lines.push('Регион;Средний темп роста;' + CLASS_SHORT.join(';'));
    DIRECTORY.forEach(function (d, i) {
      lines.push(
        '"' +
          d.region +
          '";;' +
          [0, 1, 2]
            .map(function (c) {
              return f(rsAll[c][i].avg);
            })
            .join(';'),
      );
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'temp-rosta-sbytovyh-nadbavok.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
    toast('Таблица выгружена в CSV');
  });

  // Обновление
  function setKpi(id, text, sign) {
    var el = $(id);
    $('b', el).textContent = text;
    el.classList.toggle('plus', sign > 0);
    el.classList.toggle('minus', sign < 0);
  }

  function refresh() {
    var r = evaluate();

    // карточки
    model.points.forEach(function (pt, idx) {
      var card = list.querySelector('[data-id="' + pt.id + '"]');
      if (!card) return;
      var res = r.perPoint[idx];
      $('[data-out="badge"]', card).textContent = 'ГТП ' + (idx + 1);
      $('[data-act="drop"]', card).disabled = model.points.length < 2;
      var coef = $('[data-out="coef"]', card);
      if (res.ks) {
        coef.className = 'supplier-info ok';
        var g = res.growth;
        coef.innerHTML =
          '<div><b>' +
          esc(pt.supplier) +
          '</b><span class="where">' +
          esc(pt.region) +
          ' · ' +
          POWER_CLASSES[res.cls].label +
          '</span></div>' +
          (g == null
            ? ''
            : '<div class="growth' +
              (g < 0 ? ' down' : '') +
              '"><span>Рост k₂ к k₁</span><b>' +
              (g > 0 ? '+' : '') +
              nfPct.format(g) +
              ' %</b></div>');
      } else {
        var miss = [];
        if (!pt.region) miss.push('регион');
        if (!pt.supplier) miss.push('гарантирующего поставщика');
        if (res.cls < 0) miss.push('мощность ЭПУ');
        coef.className = 'supplier-info';
        coef.innerHTML = icon('alert') + 'Для расчёта укажите: ' + miss.join(', ');
      }
      card.classList.toggle('filled', !!res.ks && res.volume > 0);
      for (var p = 0; p < PERIODS.length; p++) {
        $('[data-pk="' + p + '"]', card).textContent = res.ks
          ? 'k' + (p ? '₂' : '₁') + ' = ' + nfK.format(res.ks[p]) + ' руб./кВт·ч'
          : 'надбавка не выбрана';
        $('[data-pv="' + p + '"]', card).textContent = nfQty.format(res.pVol[p]) + ' ' + VOL_UNIT;
        $('[data-ps="' + p + '"]', card).textContent = rub(res.pSave[p]);
      }
      $('[data-out="vol"]', card).textContent = nfQty.format(res.volume);
      $('[data-out="save"]', card).textContent = rub(res.saving);
    });
    $('#gtpCount').textContent = 'всего: ' + model.points.length;

    // затраты
    model.staff.forEach(function (s, i) {
      var mth = num(s.rate) * num(s.qty);
      $('[data-cm="' + i + '"]').textContent = nfMoney.format(mth);
      $('[data-cy="' + i + '"]').textContent = nfMoney.format(mth * 12);
    });
    $('[data-cm="o"]').textContent = nfMoney.format(num(model.other));
    $('[data-cy="o"]').textContent = nfMoney.format(num(model.other) * 12);
    $('[data-cy="one"]').textContent = nfMoney.format(r.oneOff);
    var staffYear =
      model.staff.reduce(function (a, st) {
        return a + num(st.rate) * num(st.qty);
      }, 0) * 12;
    $('[data-sub="staff"]').textContent = rub(staffYear);
    $('[data-sub="infra"]').textContent = rub(r.oneOff);
    $('[data-sub="other"]').textContent = rub(num(model.other) * 12);
    $('#costTotal').textContent = rub(r.cost);

    // показатели
    setKpi('#kSave', rub(r.saving), r.saving > 0 ? 1 : 0);
    setKpi('#kCost', rub(r.cost), 0);
    setKpi('#kEffect', rub(r.effect), r.saving || r.cost ? (r.effect >= 0 ? 1 : -1) : 0);
    setKpi('#kEff', nfMoney.format(r.efficiency) + ' %', r.cost ? (r.efficiency >= 100 ? 1 : -1) : 0);
    var pb = r.payback;
    setKpi(
      '#kPay',
      pb == null
        ? r.saving > 0
          ? 'не окупается'
          : '—'
        : pb < 0.05
          ? 'сразу'
          : '≈ ' + pb.toFixed(1).replace('.', ',') + ' мес.',
      pb == null ? (r.saving > 0 ? -1 : 0) : pb <= 12 ? 1 : 0,
    );

    // вердикт
    var v = $('#verdict'),
      state,
      title,
      text;
    if (r.saving <= 0) {
      state = '';
      title = 'Введите данные';
      text = 'Заполните параметры и потребление хотя бы одной ГТП';
    } else if (r.effect < 0) {
      state = 'bad';
      title = 'Выход нецелесообразен';
      text = 'Затраты превышают экономию на ' + rub(-r.effect);
    } else if (r.efficiency < 120) {
      state = 'warn';
      title = 'На грани окупаемости';
      text = 'Эффект положительный, но запас меньше 20 %';
    } else {
      state = 'good';
      title = 'Выход на ОРЭМ целесообразен';
      text = 'Годовой эффект ' + rub(r.effect);
    }
    v.className = 'verdict ' + state;
    v.innerHTML = '<b>' + title + '</b><span>' + text + '</span>';

    // формула суммы

    drawChart(r);
    var sig = model.points
      .map(function (p) {
        return p.region;
      })
      .join('|');
    if (sig !== an.sig) {
      an.sig = sig;
      renderAnalytics();
    }
    persist();
  }

  // Сохранение и загрузка
  var saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(model));
        $('#savedAt').textContent =
          'черновик сохранён в ' +
          new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        /* хранилище недоступно — работаем без автосохранения */
      }
    }, 400);
  }
  // в старых черновиках мощность хранилась числом в кВт
  function oldPower(v) {
    if (v == null || v === '') return '';
    var n = num(v);
    if (n === 1 || n === 2) return String(n);
    if (n >= 10000) return '2';
    if (n >= 670) return '1';
    return '';
  }

  function adopt(data) {
    var base = defaultModel();
    if (!data || !Array.isArray(data.points) || !data.points.length) throw new Error('bad');
    seq = 0;
    base.points = data.points.map(function (p) {
      var vol = Array.isArray(p.vol) ? p.vol.slice(0, 12) : [];
      while (vol.length < 12) vol.push('');
      return {
        id: ++seq,
        name: p.name || '',
        region: p.region || '',
        supplier: p.supplier || '',
        power: oldPower(p.power),
        vol: vol.map(function (x) {
          return x == null ? '' : String(x);
        }),
      };
    });
    if (Array.isArray(data.staff) && data.staff.length === base.staff.length)
      base.staff = data.staff.map(function (s, i) {
        return { title: base.staff[i].title, rate: s.rate, qty: s.qty };
      });
    if (data.other != null) base.other = data.other;
    if (data.oneOff) base.oneOff = { rate: data.oneOff.rate, qty: data.oneOff.qty };
    model = base;
    renderCosts();
    renderPoints();
  }

  // Отчёт PDF
  var PDF_LIB = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
  var pdfLibPromise = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (!pdfLibPromise)
      pdfLibPromise = new Promise(function (ok, fail) {
        var sc = document.createElement('script');
        sc.src = PDF_LIB;
        sc.onload = function () {
          ok(window.html2pdf);
        };
        sc.onerror = function () {
          pdfLibPromise = null;
          fail(new Error('lib'));
        };
        document.head.appendChild(sc);
      });
    return pdfLibPromise;
  }

  function reportHTML(r) {
    var C = {
      ink: '#23202b',
      muted: '#6e6a75',
      line: '#e3ded3',
      soft: '#f6f3ed',
      violet: '#5b3fd0',
      violetPale: '#efebfc',
      violetLight: '#7b5cf0',
      lilac: '#f1edfd',
      neg: '#c23a3a',
      negSoft: '#fbecec',
      warn: '#a86a12',
      warnSoft: '#fbf2e2',
      ok: '#2f7d54',
      okSoft: '#eaf4ee',
    };
    var mono = 'font-family:JetBrains Mono,monospace;';
    var th =
      'style="text-align:left;padding:6px 8px;font-size:10.5px;color:' +
      C.muted +
      ';font-weight:600;border-bottom:1px solid ' +
      C.line +
      '"';
    var thr = th.replace('text-align:left', 'text-align:right');
    function td(v, right, extra) {
      return (
        '<td style="padding:6px 8px;font-size:11.5px;border-bottom:1px solid ' +
        C.line +
        ';' +
        (right ? 'text-align:right;' + mono : '') +
        (extra || '') +
        '">' +
        v +
        '</td>'
      );
    }
    function h2(n, t) {
      return (
        '<h2 style="margin:22px 0 10px;font-size:14px;font-weight:700;padding-bottom:6px;border-bottom:1px solid ' +
        C.line +
        '"><span style="color:' +
        C.violet +
        ';' +
        mono +
        'margin-right:8px">' +
        n +
        '</span>' +
        t +
        '</h2>'
      );
    }

    var vState =
      r.saving <= 0
        ? ['Нет данных для вывода', 'Заполните параметры и потребление ГТП', C.soft, C.muted]
        : r.effect < 0
          ? [
              'Выход на ОРЭМ нецелесообразен',
              'Затраты превышают экономию на ' + rub(-r.effect),
              C.negSoft,
              C.neg,
            ]
          : r.efficiency < 120
            ? ['На грани окупаемости', 'Эффект положительный, но запас меньше 20 %', C.warnSoft, C.warn]
            : ['Выход на ОРЭМ целесообразен', 'Годовой эффект ' + rub(r.effect), C.okSoft, C.ok];
    var pb =
      r.payback == null
        ? r.saving > 0
          ? 'не окупается'
          : '—'
        : r.payback < 0.05
          ? 'сразу'
          : '≈ ' + r.payback.toFixed(1).replace('.', ',') + ' мес.';
    function kpi(label, val, color) {
      return (
        '<td style="width:20%;padding:9px 10px;white-space:nowrap;background:' +
        C.soft +
        ';border-radius:8px;vertical-align:top"><div style="font-size:10px;color:' +
        C.muted +
        ';font-weight:600">' +
        label +
        '</div><div style="' +
        mono +
        'font-size:11.5px;font-weight:600;margin-top:3px;color:' +
        (color || C.ink) +
        '">' +
        val +
        '</div></td>'
      );
    }

    var out = [];
    out.push(
      '<div style="width:760px;padding:28px 34px;font-family:Golos Text,Arial,sans-serif;color:' +
        C.ink +
        ';background:#fff;box-sizing:border-box">',
    );
    out.push(
      '<div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid ' +
        C.violet +
        ';padding-bottom:14px">' +
        '<div style="width:36px;height:36px;border-radius:8px;background:' +
        C.violetLight +
        ';flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg></div>' +
        '<div style="flex:1"><div style="font-size:18px;font-weight:800;line-height:1.2">Оценка целесообразности выхода промышленного потребителя на ОРЭМ</div>' +
        '<div style="font-size:11px;color:' +
        C.muted +
        ';margin-top:3px">Отчёт сформирован ' +
        new Date().toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) +
        '</div></div></div>',
    );
    out.push(
      '<div style="margin-top:16px;padding:12px 16px;border-radius:8px;background:' +
        vState[2] +
        ';border-left:5px solid ' +
        vState[3] +
        '"><div style="font-size:15px;font-weight:700">' +
        vState[0] +
        '</div><div style="font-size:11.5px;color:' +
        C.muted +
        ';margin-top:2px">' +
        vState[1] +
        '</div></div>',
    );
    out.push(
      '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin:10px -6px 0"><tr>' +
        kpi('Экономия за год', rub(r.saving), C.violet) +
        kpi('Затраты за год', rub(r.cost)) +
        kpi('Эффект', rub(r.effect), r.effect < 0 ? C.neg : C.ok) +
        kpi('Эффективность', nfMoney.format(r.efficiency) + ' %') +
        kpi('Срок окупаемости', pb) +
        '</tr></table>',
    );

    out.push(h2('01', 'Группы точек поставки'));
    model.points.forEach(function (pt, i) {
      var e = r.perPoint[i];
      var head =
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><div style="font-size:13px;font-weight:700">ГТП ' +
        (i + 1) +
        (pt.name ? ' · ' + esc(pt.name) : '') +
        '</div>' +
        '<div style="' +
        mono +
        'font-size:12.5px;color:' +
        C.violet +
        ';font-weight:600">' +
        rub(e.saving) +
        '</div></div>';
      var meta =
        '<div style="font-size:11px;color:' +
        C.muted +
        ';margin:4px 0 8px">' +
        (pt.region ? esc(pt.region) : 'регион не выбран') +
        ' · ' +
        (pt.supplier ? esc(pt.supplier) : 'ГП не выбран') +
        ' · мощность ЭПУ ' +
        (e.cls >= 0 ? POWER_CLASSES[e.cls].label : '—') +
        (e.ks
          ? '<br>k₁ (' +
            PERIODS[0].label +
            ') = ' +
            nfK.format(e.ks[0]) +
            ' · k₂ (' +
            PERIODS[1].label +
            ') = ' +
            nfK.format(e.ks[1]) +
            ' руб./кВт·ч · темп роста ' +
            (e.growth > 0 ? '+' : '') +
            nfPct.format(e.growth) +
            ' %'
          : '') +
        '</div>';
      var hdr =
        '<tr><th ' +
        th +
        '>кВт·ч / ₽</th>' +
        MONTHS_SHORT.map(function (m, k) {
          return (
            '<th ' +
            thr.replace('color:' + C.muted, 'color:' + (k >= PERIODS[1].from ? C.violetLight : C.muted)) +
            '>' +
            m +
            '</th>'
          );
        }).join('') +
        '</tr>';
      var cell = 'font-size:9.5px;padding:5px 3px;white-space:nowrap';
      var lab = 'color:' + C.muted + ';font-size:9.5px;white-space:nowrap;padding:5px 4px';
      var rowV =
        '<tr>' +
        td('W, тыс. ' + VOL_UNIT, false, lab) +
        pt.vol
          .map(function (v) {
            return td(nfInt.format(num(v) / 1000), true, cell);
          })
          .join('') +
        '</tr>';
      var rowS =
        '<tr>' +
        td('Э, тыс. ₽', false, lab) +
        e.monthlySaving
          .map(function (v) {
            return td(nfInt.format(v / 1000), true, cell);
          })
          .join('') +
        '</tr>';
      var f = e.ks
        ? '<div style="font-size:10px;color:' +
          C.muted +
          ';margin-top:6px">Э' +
          (i + 1) +
          ' = ' +
          nfK.format(e.ks[0]) +
          ' × ' +
          nfQty.format(e.pVol[0]) +
          ' + ' +
          nfK.format(e.ks[1]) +
          ' × ' +
          nfQty.format(e.pVol[1]) +
          ' = ' +
          nfMoney.format(e.saving) +
          ' ₽ · потребление за год ' +
          nfQty.format(e.volume) +
          ' ' +
          VOL_UNIT +
          '</div>'
        : '';
      out.push(
        '<div class="rp-block" style="border:1px solid ' +
          C.line +
          ';border-radius:8px;padding:12px 14px;margin-bottom:10px">' +
          head +
          meta +
          '<table style="width:100%;border-collapse:collapse">' +
          hdr +
          rowV +
          rowS +
          '</table>' +
          f +
          '</div>',
      );
    });

    out.push('<div class="rp-block">' + h2('02', 'Затраты на выход и работу на ОРЭМ'));
    function grp(n, t) {
      return (
        '<tr><td colspan="5" style="padding:12px 8px 5px;font-size:12px;font-weight:700;border-bottom:1px solid ' +
        C.line +
        '"><span style="color:' +
        C.violet +
        ';' +
        mono +
        'margin-right:6px">' +
        n +
        '.</span>' +
        t +
        '</td></tr>'
      );
    }
    function sub(v) {
      return (
        '<tr><td colspan="4" style="padding:6px 8px;font-size:11px;color:' +
        C.muted +
        ';background:' +
        C.violetPale +
        '">Итого по разделу</td><td style="padding:6px 8px;text-align:right;' +
        mono +
        'font-size:11.5px;font-weight:600;color:' +
        C.violet +
        ';background:' +
        C.violetPale +
        '">' +
        rub(v) +
        '</td></tr>'
      );
    }
    var rows = [grp(1, 'Затраты на штат специалистов по работе на ОРЭМ')],
      staffY = 0;
    model.staff.forEach(function (st) {
      var m = num(st.rate) * num(st.qty);
      staffY += m * 12;
      rows.push(
        '<tr>' +
          td(esc(st.title) + ' (оклад в месяц)') +
          td(nfMoney.format(num(st.rate)), true) +
          td(nfQty.format(num(st.qty)), true) +
          td(nfMoney.format(m), true) +
          td(nfMoney.format(m * 12), true) +
          '</tr>',
      );
    });
    rows.push(sub(staffY));
    rows.push(grp(2, 'Затраты на инфраструктуру ОРЭМ'));
    rows.push(
      '<tr>' +
        td('Платежи на инфраструктуру') +
        td(nfMoney.format(num(model.oneOff.rate)), true) +
        td(nfQty.format(num(model.oneOff.qty)), true) +
        td('—', true) +
        td(nfMoney.format(r.oneOff), true) +
        '</tr>',
    );
    rows.push(sub(r.oneOff));
    rows.push(grp(3, 'Прочие затраты'));
    rows.push(
      '<tr>' +
        td('Прочие расходы (в месяц)') +
        td(nfMoney.format(num(model.other)), true) +
        td('—', true) +
        td(nfMoney.format(num(model.other)), true) +
        td(nfMoney.format(num(model.other) * 12), true) +
        '</tr>',
    );
    rows.push(sub(num(model.other) * 12));
    rows.push(
      '<tr><td colspan="4" style="padding:9px 8px;font-size:12.5px;font-weight:700;border-top:2px solid ' +
        C.ink +
        '">Итого затраты</td><td style="padding:9px 8px;text-align:right;' +
        mono +
        'font-size:13px;font-weight:700;color:' +
        C.violet +
        ';border-top:2px solid ' +
        C.ink +
        '">' +
        rub(r.cost) +
        '</td></tr>',
    );
    out.push(
      '<table style="width:100%;border-collapse:collapse"><tr><th ' +
        th +
        '>Статья</th><th ' +
        thr +
        '>Ставка, ₽</th><th ' +
        thr +
        '>Кол-во</th><th ' +
        thr +
        '>В месяц</th><th ' +
        thr +
        '>За год</th></tr>' +
        rows.join('') +
        '</table></div>',
    );

    out.push('<div class="rp-block">' + h2('03', 'Накопленный результат по месяцам'));
    out.push(
      '<svg viewBox="0 0 600 260" width="690" height="299" xmlns="http://www.w3.org/2000/svg">' +
        chartMarkup(r, PDF_PAL) +
        '</svg>',
    );
    out.push(
      '<div style="font-size:10.5px;color:' +
        C.muted +
        '"><span style="color:' +
        C.violet +
        '">━</span> накопленная экономия &nbsp; <span style="color:' +
        C.neg +
        '">┅</span> накопленные затраты (разовые платежи — в начале года) &nbsp; <span style="color:' +
        C.violetLight +
        '">│</span> точка окупаемости</div></div>',
    );

    out.push('<div class="rp-block">' + h2('04', 'Методика расчёта'));
    out.push(
      '<ol style="margin:0;padding-left:18px;font-size:11px;color:' +
        C.muted +
        ';line-height:1.6">' +
        '<li>Класс мощности ГТП выбирается по максимальной мощности ЭПУ: от 670 кВт до 10 МВт или не менее 10 МВт.</li>' +
        '<li>Сбытовые надбавки ГП (руб./кВт·ч без НДС): k₁ — ' +
        PERIODS[0].label +
        ', k₂ — ' +
        PERIODS[1].label +
        '.</li>' +
        '<li>Экономия по ГТП: Эᵢ = k₁·ΣW(янв–сен) + k₂·ΣW(окт–дек); общая экономия Э = ' +
        r.perPoint
          .map(function (_, i) {
            return 'Э' + (i + 1);
          })
          .join(' + ') +
        ' = ' +
        rub(r.saving) +
        '.</li>' +
        '<li>Затраты: З = Зштат + Зинфр + Зпроч, где Зштат = 12·Σ(оклад × численность) — штат специалистов по работе на ОРЭМ; Зинфр — затраты на инфраструктуру ОРЭМ; Зпроч = 12·прочие расходы в месяц. Итого ' +
        rub(r.cost) +
        '.</li>' +
        '<li>Эффект = Э − З; эффективность = Э / З · 100 %.</li></ol></div>',
    );
    out.push('</div>');
    return out.join('');
  }

  $('#btnSave').addEventListener('click', function () {
    var btn = this;
    if (btn.disabled) return;
    btn.disabled = true;
    toast('Формируем PDF…');
    var r = evaluate();
    loadPdfLib()
      .then(function (h2p) {
        var holder = document.createElement('div');
        holder.innerHTML = reportHTML(r);
        return h2p()
          .set({
            margin: [8, 0, 10, 0],
            filename: 'orem-otchet-' + new Date().toISOString().slice(0, 10) + '.pdf',
            image: { type: 'jpeg', quality: 0.96 },
            html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, scrollX: 0, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'], avoid: '.rp-block' },
          })
          .from(holder.firstChild)
          .save();
      })
      .then(function () {
        toast('PDF-отчёт сохранён');
      })
      .catch(function () {
        toast('Не удалось сформировать PDF — проверьте подключение к интернету');
      })
      .then(function () {
        btn.disabled = false;
      });
  });
  $('#btnReset').addEventListener('click', function () {
    if (!window.confirm('Очистить все данные расчёта?')) return;
    seq = 0;
    model = defaultModel();
    renderCosts();
    renderPoints();
    toast('Данные очищены');
  });

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
    }, 2200);
  }

  document.addEventListener('mousedown', function (e) {
    if (combo.input && !e.target.closest('.region')) closeCombo();
  });

  // Главная
  function renderHome() {
    var all = [];
    GP_TABLE.forEach(function (row) {
      if (row[3] > 0) all.push((row[6] / row[3] - 1) * 100);
    });
    $('#stRegions').textContent = DIRECTORY.length;
    $('#stSuppliers').textContent = GP_TABLE.length;
    $('#stGrowth').textContent = (mean(all) > 0 ? '+' : '') + Math.round(mean(all)) + '%';
  }

  // Роутер
  var ROUTES = ['', 'raschet', 'analitika', 'metodika'];
  function route() {
    var r = location.hash.replace(/^#\/?/, '').split(/[?#]/)[0];
    if (ROUTES.indexOf(r) < 0) r = '';
    var page;
    document.querySelectorAll('.page').forEach(function (pg) {
      var on = pg.dataset.page === r;
      pg.classList.toggle('active', on);
      if (on) page = pg;
    });
    document.querySelectorAll('.menu a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === r);
    });
    document.title =
      (page.dataset.title === 'Главная' ? '' : page.dataset.title + ' · ') +
      'ОРЭМ·Модель — оценка выхода на оптовый рынок';
    $('#menu').classList.remove('open');
    $('#btnMenu').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('#btnMenu').addEventListener('click', function () {
    var open = $('#menu').classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
  });

  // Старт
  var restored = false;
  try {
    var saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      adopt(JSON.parse(saved));
      restored = true;
    }
  } catch (e) {
    restored = false;
  }
  if (!restored) {
    renderCosts();
    renderPoints();
  }
  renderHome();
  route();
})();
