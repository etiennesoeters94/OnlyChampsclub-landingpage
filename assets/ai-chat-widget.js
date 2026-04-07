(function () {
  const root = document.querySelector('[data-onlychamps-chat]');

  if (!root) {
    return;
  }

  const configElement = root.querySelector('[data-chat-config]');

  if (!configElement) {
    return;
  }

  const config = JSON.parse(configElement.textContent);
  const storageKey = 'onlychamps-chat-history';
  const contextKey = 'onlychamps-chat-context';
  const openKey = 'onlychamps-chat-open';
  const shopUrl = '/collections/online-champagne-kopen';
  const toggle = root.querySelector('[data-chat-toggle]');
  const panel = root.querySelector('[data-chat-panel]');
  const closeButton = root.querySelector('[data-chat-close]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const messages = root.querySelector('[data-chat-messages]');
  const suggestions = root.querySelector('[data-chat-suggestions]');
  const submit = root.querySelector('[data-chat-submit]');

  let history = loadHistory();
  let chatContext = loadContext();
  let isBusy = false;

  function loadHistory() {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      return [];
    }
  }

  function saveHistory() {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(history.slice(-12)));
    } catch (error) {}
  }

  function loadContext() {
    try {
      const saved = window.sessionStorage.getItem(contextKey);
      if (!saved) {
        return { priceFilters: [], occasionFilter: null };
      }

      const parsed = JSON.parse(saved);
      return {
        priceFilters: Array.isArray(parsed.priceFilters) ? parsed.priceFilters : [],
        occasionFilter: parsed.occasionFilter || null,
      };
    } catch (error) {
      return { priceFilters: [], occasionFilter: null };
    }
  }

  function saveContext() {
    try {
      window.sessionStorage.setItem(contextKey, JSON.stringify(chatContext));
    } catch (error) {}
  }

  function setOpen(isOpen) {
    root.classList.toggle('is-open', isOpen);
    panel.setAttribute('aria-hidden', String(!isOpen));
    toggle.setAttribute('aria-expanded', String(isOpen));
    try {
      window.sessionStorage.setItem(openKey, isOpen ? 'true' : 'false');
    } catch (error) {}

    if (isOpen) {
      window.setTimeout(function () {
        input.focus();
      }, 120);
    }
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Rendert [linktekst](url) naar veilige <a>-tags; ondersteunt ook raw https:// URLs
  function linkify(value) {
    // Escape HTML zodat er geen XSS mogelijk is via de tekst
    var escaped = escapeHtml(value);

    // Vervang markdown-links [tekst](url) door <a>-tags
    escaped = escaped.replace(
      /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]{1,400}|(\/[^)\s]{0,400}))\)/g,
      function (match, text, url) {
        var isExternal = /^https?:\/\//.test(url);
        return '<a href="' + url + '"' +
          (isExternal ? ' target="_blank" rel="noopener noreferrer"' : '') +
          '>' + text + '<\/a>';
      }
    );

    // Vervang ook losse https-URLs nog als fallback
    escaped = escaped.replace(
      /(^|[^"\/>])(https?:\/\/[^\s<]{1,400})/g,
      function (match, prefix, url) {
        return prefix + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '<\/a>';
      }
    );

    return escaped;
  }

  function renderMessages() {
    messages.innerHTML = '';

    const initialMessages = history.length
      ? history
      : [
          {
            role: 'bot',
            text: config.welcomeMessage,
          },
        ];

    initialMessages.forEach(function (message) {
      const item = document.createElement('div');
      item.className = 'onlychamps-chat__message onlychamps-chat__message--' + message.role;
      item.innerHTML = linkify(message.text);
      messages.appendChild(item);
    });

    messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
  }

  function renderSuggestions(list) {
    suggestions.innerHTML = '';

    list.forEach(function (suggestion) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'onlychamps-chat__suggestion';
      button.textContent = suggestion;
      button.addEventListener('click', function () {
        input.value = suggestion;
        form.requestSubmit();
      });
      suggestions.appendChild(button);
    });
  }

  function addMessage(role, text) {
    history.push({ role: role, text: text });
    saveHistory();
    renderMessages();
  }

  function addTyping() {
    const item = document.createElement('div');
    item.className = 'onlychamps-chat__message onlychamps-chat__message--bot onlychamps-chat__message--typing';
    item.dataset.chatTyping = 'true';
    item.textContent = 'OnlyChamps Sommelier denkt mee...';
    messages.appendChild(item);
    messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
  }

  function removeTyping() {
    const typing = messages.querySelector('[data-chat-typing="true"]');
    if (typing) {
      typing.remove();
    }
  }

  function extractBudget(message) {
    const match = message.match(/(?:€|eur|euro)?\s?(\d{2,4})/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function uniqueFilters(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function detectOccasionFilter(value) {
    if (/(cadeau|geschenk|verjaardag|jubileum)/.test(value)) {
      return 'gelegenheid-cadeau';
    }

    if (/(diner|eten|pairing|spijs|gerecht)/.test(value)) {
      return 'gelegenheid-diner';
    }

    if (/(aperitief|borrel|ontvangst)/.test(value)) {
      return 'gelegenheid-aperitief';
    }

    if (/(feest|party|vieren|huwelijk|bruiloft)/.test(value)) {
      return 'gelegenheid-feest';
    }

    if (/(bijzondere gelegenheid|speciaal moment)/.test(value)) {
      return 'gelegenheid-bijzondere-gelegenheid';
    }

    return null;
  }

  function detectPriceFilters(value, budget) {
    if (/(onder|tot|max(?:imaal)?|minder dan)\s*(de\s*)?60/.test(value)) {
      return ['under-40', '40-60'];
    }

    if (/(onder|tot|max(?:imaal)?|minder dan)\s*(de\s*)?40/.test(value)) {
      return ['under-40'];
    }

    if (/(onder|tot|max(?:imaal)?|minder dan)\s*(de\s*)?100/.test(value)) {
      return ['under-40', '40-60', '60-100'];
    }

    if (/40\s*(?:-|tot)\s*60/.test(value)) {
      return ['40-60'];
    }

    if (/60\s*(?:-|tot)\s*100/.test(value)) {
      return ['60-100'];
    }

    if (budget === null) {
      return null;
    }

    if (budget <= 40) {
      return ['under-40'];
    }

    if (budget <= 60) {
      return ['40-60'];
    }

    if (budget <= 100) {
      return ['60-100'];
    }

    return ['100-plus'];
  }

  function updateChatContext(value, budget) {
    const occasion = detectOccasionFilter(value);
    const priceFilters = detectPriceFilters(value, budget);

    if (occasion) {
      chatContext.occasionFilter = occasion;
    }

    if (priceFilters && priceFilters.length) {
      chatContext.priceFilters = uniqueFilters(priceFilters);
    }

    saveContext();
    return chatContext;
  }

  function buildCollectionUrl(filterTokens) {
    const filters = uniqueFilters(filterTokens || []);
    if (!filters.length) {
      return shopUrl;
    }

    return shopUrl + '?filter=' + filters.join(',');
  }

  function getFallbackReply(message) {
    const value = message.toLowerCase();
    const budget = extractBudget(value);
    const activeContext = updateChatContext(value, budget);
    const contactOptions = [];

    if (config.whatsappUrl) {
      contactOptions.push('WhatsApp: ' + config.whatsappUrl);
    }

    if (config.emailUrl) {
      contactOptions.push('E-mail: ' + config.emailUrl.replace('mailto:', ''));
    }

    if (/(verzend|lever|bezorg|ontvang)/.test(value)) {
      return {
        reply:
          'Goede vraag. Voor actuele levertijden en verzendopties raad ik je aan om de verzendinformatie op de shop te bekijken. Ik help je intussen graag met een passende champagne, bijvoorbeeld voor een cadeau of een specifiek moment.\n\nVoor een concrete ordervraag kun je het snelst contact opnemen via ' +
          (contactOptions[0] || 'de contactpagina') +
          '.',
        suggestions: ['Wat is een goed cadeau?', 'Welke fles is feestelijk?', 'Ik zoek iets onder 60 euro'],
      };
    }

    if (/(retour|retourneren|omruil|terugsturen)/.test(value)) {
      return {
        reply:
          'Voor retouren of omruilen helpt ons team je het snelst met een antwoord op jouw bestelling. ' +
          (contactOptions.join(' | ') || ''),
        suggestions: ['Hoe snel wordt geleverd?', 'Ik zoek advies voor een diner'],
      };
    }

    function urlFor(occasionTokens) {
      var tokens = [];

      if (activeContext.priceFilters && activeContext.priceFilters.length) {
        tokens = tokens.concat(activeContext.priceFilters);
      }

      if (occasionTokens) {
        if (Array.isArray(occasionTokens)) {
          tokens = tokens.concat(occasionTokens);
        } else {
          tokens.push(occasionTokens);
        }
      } else if (activeContext.occasionFilter) {
        tokens.push(activeContext.occasionFilter);
      }

      return buildCollectionUrl(tokens);
    }

    if (/(cadeau|geschenk|verjaardag|jubileum)/.test(value)) {
      var luxe = budget && budget >= 60;
      return {
        reply:
          'Voor een cadeau adviseren we meestal een elegante, toegankelijke champagne die breed in de smaak valt. ' +
          (luxe
            ? 'Met een ruimer budget kun je kiezen voor iets bijzonders, zoals een prestige cuvée of een karaktervolle grower champagne.'
            : 'Kies bij voorkeur een fles met frisse balans, zodat die zowel als aperitief als aan tafel mooi tot zijn recht komt.') +
          '\n\nBekijk onze [cadeauselectie](' + urlFor('gelegenheid-cadeau') + ') met je actieve voorkeuren. Wil je dat ik ook een luxe optie en een veilige keuze naast elkaar zet?',
        suggestions: ['Cadeau onder 60 euro', 'Luxe cadeau (60+)', 'Fles voor verjaardag'],
      };
    }

    if (/(diner|eten|pairing|spijs|gerecht)/.test(value)) {
      return {
        reply:
          'Voor een diner kijken we vooral naar balans en intensiteit. Licht en strak werkt mooi bij oesters of een verfijnd voorgerecht; rijper en ronder past beter bij gevogelte, romige sauzen of een uitgebreider menu.\n\n' +
          'Bekijk champagnes voor [diner](' + urlFor('gelegenheid-diner') + '). Deel gerust je gerecht, dan maak ik het advies nog specifieker.',
        suggestions: ['Champagne bij oesters', 'Champagne bij dessert', 'Champagne voor aperitief'],
      };
    }

    if (/(aperitief|borrel|ontvangst)/.test(value)) {
      return {
        reply:
          'Voor aperitief of ontvangst adviseren we een frisse, levendige stijl die elegant opent zonder te overheersen.\n\n' +
          'Bekijk onze [aperitief-selectie](' + urlFor('gelegenheid-aperitief') + ').',
        suggestions: ['Cadeau onder 60 euro', 'Welke stijl past bij mij?', 'Champagne bij diner'],
      };
    }

    if (/(feest|party|vieren|jubileum|huwelijk|bruiloft)/.test(value)) {
      return {
        reply:
          'Voor een feest of bijzondere viering adviseren we een cuvée met karakter en uitstraling, zodat het moment echt bijzonder aanvoelt.\n\n' +
          '[Bekijk de feest- en bijzondere gelegenheid selectie](' + urlFor(['gelegenheid-feest', 'gelegenheid-bijzondere-gelegenheid']) + ').',
        suggestions: ['Luxe fles voor feest', 'Cadeau voor huwelijk', 'Cadeau onder 60 euro'],
      };
    }

    if (/(brut|droog|zoet|fris|mineral|rijk)/.test(value)) {
      return {
        reply:
          'Hou je van strak en fris, kies dan voor een droge, minerale stijl. Zoek je juist meer ronding en comfort, dan past een rijkere cuvée vaak beter.\n\n' +
          '[Bekijk alle champagnes](' + buildCollectionUrl(activeContext.priceFilters || []) + ') en filter op stijl, gelegenheid of budget.',
        suggestions: ['Frisse champagne', 'Rijkere stijl', 'Advies voor aperitief'],
      };
    }

    if (budget !== null) {
      return {
        reply:
          'Met een budget rond \u20ac' + budget + ' kunnen we heel gericht selecteren.\n\n' +
          '[Bekijk champagnes in jouw prijsklasse](' + urlFor() + '). Zoek je iets als cadeau, voor diner of om zelf van te genieten?',
        suggestions: ['Als cadeau', 'Voor diner', 'Gewoon genieten'],
      };
    }

    if (/(korting|nieuwsbrief|onlychamps|deal)/.test(value)) {
      return {
        reply:
          'Via de nieuwsbrief blijf je als eerste op de hoogte van exclusieve releases, insider deals en acties. Inschrijven kan via het formulier onderaan de pagina.\n\nZal ik je meteen helpen met een eerste selectie? [Bekijk het volledige assortiment](' + buildCollectionUrl(activeContext.priceFilters || []) + ').',
        suggestions: ['Bestsellers', 'Fles voor cadeau', 'Iets feestelijks'],
      };
    }

    return {
      reply:
        'Ik help je graag met persoonlijk champagne-advies en veelgestelde vragen. Denk aan cadeaukeuze, stijlvoorkeur, food pairing of een snelle eerste selectie.\n\n' +
        '[Bekijk alle champagnes](' + buildCollectionUrl(activeContext.priceFilters || []) + ') — filter op gelegenheid, stijl of budget.' +
        (contactOptions.length ? '\n\nVoor order-specifieke vragen: ' + contactOptions.join(' | ') : ''),
      suggestions: ['Ik zoek een cadeau', 'Welke stijl past bij mij?', 'Wat past bij een diner?'],
    };
  }

  async function fetchReply(message) {
    if (!config.endpoint) {
      return getFallbackReply(message);
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        history: history.slice(-10),
        shop: config.shopName,
        page: window.location.href,
        locale: document.documentElement.lang || 'nl',
      }),
    });

    if (!response.ok) {
      throw new Error('Chat endpoint failed');
    }

    const data = await response.json();

    if (!data.reply) {
      throw new Error('Missing reply');
    }

    return {
      reply: data.reply,
      suggestions: Array.isArray(data.suggestions) && data.suggestions.length ? data.suggestions.slice(0, 3) : null,
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const message = input.value.trim();

    if (!message) {
      return;
    }

    isBusy = true;
    submit.disabled = true;

    addMessage('user', message);
    input.value = '';
    addTyping();

    try {
      const result = await fetchReply(message);
      removeTyping();
      addMessage('bot', result.reply);
      renderSuggestions(result.suggestions || config.defaultSuggestions);
    } catch (error) {
      removeTyping();
      const fallback = getFallbackReply(message);
      addMessage('bot', fallback.reply);
      renderSuggestions(fallback.suggestions || config.defaultSuggestions);
    } finally {
      isBusy = false;
      submit.disabled = false;
      input.focus();
    }
  }

  toggle.addEventListener('click', function () {
    setOpen(!root.classList.contains('is-open'));
  });

  closeButton.addEventListener('click', function () {
    setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && root.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  form.addEventListener('submit', handleSubmit);

  if (window.sessionStorage.getItem(openKey) === 'true') {
    setOpen(true);
  }

  renderMessages();
  renderSuggestions(config.defaultSuggestions);
})();