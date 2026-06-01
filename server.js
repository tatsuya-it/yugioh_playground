const express = require('express');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());
app.use(express.static('.'));

function extractCardData($, cid) {
  const h1 = $('#cardname h1');
  const name = h1.clone().find('span').remove().end().text().trim()
             || h1.text().replace(/\s+/g, ' ').trim();
  if (!name || name === 'none') return null;

  const ruby = $('#cardname .ruby').first().text().trim()
             || $('.card_ruby').first().text().trim();
  const imageUrl = $('meta[property="og:image"]').attr('content') || '';

  if (imageUrl.includes('cid=&')) return null;

  const itemBoxes = $('#CardSet .item_box');
  let attribute = '', level = '', atk = '', def = '', race = '', text = '';
  itemBoxes.each((_, el) => {
    const title = $(el).find('.item_box_title').text().trim();
    const value = $(el).find('.item_box_value').text().trim();
    if (title.includes('属性') || $(el).find('img[alt*="属性"]').length) attribute = value;
    else if (title === 'ATK') atk = value;
    else if (title === 'DEF') def = value.replace(/\s+/g, '');
    else if (value.includes('レベル')) level = value.replace('レベル', '').trim();
    const raceSpan = $(el).find('span').filter((_, s) => $(s).text().includes('族'));
    if (raceSpan.length) race = raceSpan.first().text().trim();
  });
  // カードテキスト（.CardText > .item_box_text、<br>で区切られている）
  const textEl = $('.CardText .item_box_text');
  if (textEl.length) {
    textEl.find('.text_title').remove();
    text = textEl.html()
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&[^;]+;/g, s => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[s] || s)
      .trim();
  }
  return { cid, name, ruby, imageUrl, attribute, level, atk, def, race, text };
}

app.get('/api/card', async (req, res) => {
  const cid = req.query.cid || '23160';
  const url = `https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=${cid}&request_locale=ja`;
  const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
  const $ = cheerio.load(html);
  res.json(extractCardData($, cid) || {});
});

app.get('/api/deck-from-url', async (req, res) => {
  const deckUrl = req.query.url;
  if (!deckUrl) return res.status(400).json({ error: 'url required' });

  try {
    const html = await fetch(deckUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
    const $ = cheerio.load(html);

    const cids = [];
    ['#monster_list', '#spell_list', '#trap_list'].forEach(selector => {
      $(selector).find('tr').each((_, tr) => {
        const cidMatch = $(tr).find('input.link_value').val()?.match(/cid=(\d+)/);
        const num = parseInt($(tr).find('td.num span').text().trim()) || 0;
        if (cidMatch && num > 0) {
          for (let i = 0; i < num; i++) cids.push(cidMatch[1]);
        }
      });
    });

    const extraCids = [];
    $('#extra_list').find('tr').each((_, tr) => {
      const cidMatch = $(tr).find('input.link_value').val()?.match(/cid=(\d+)/);
      const num = parseInt($(tr).find('td.num span').text().trim()) || 0;
      if (cidMatch && num > 0) {
        for (let i = 0; i < num; i++) extraCids.push(cidMatch[1]);
      }
    });

    if (!cids.length && !extraCids.length) return res.status(400).json({ error: 'カードが見つかりませんでした' });
    res.json({ cids, extraCids });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cards', async (req, res) => {
  const cids = (req.body.cids || []).map(s => String(s).trim()).filter(Boolean);
  if (!cids.length) return res.json([]);

  // ユニークcidのみフェッチ（重複リクエストを避ける）
  const uniqueCids = [...new Set(cids)];
  const cardMap = {};

  await Promise.all(uniqueCids.map(async cid => {
    try {
      const url = `https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=${cid}&request_locale=ja`;
      const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
      const $ = cheerio.load(html);
      const card = extractCardData($, cid);
      if (!card) {
        console.warn(`[skip] cid=${cid} url=${url} : .card_name が空のため存在しないcidとして除外`);
        return;
      }
      cardMap[cid] = card;
    } catch (e) {
      console.warn(`[error] cid=${cid} : ${e.message}`);
    }
  }));

  // 元のcidリスト順に展開して返す（重複あり）
  const results = cids.map(cid => cardMap[cid] || null).filter(Boolean);
  res.json(results);
});

app.listen(3000, () => console.log('http://localhost:3000'));
