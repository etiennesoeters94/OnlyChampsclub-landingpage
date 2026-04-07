const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getShopifyToken(storeDomain, clientId, clientSecret) {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt) {
    return _cachedToken;
  }

  const response = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

  if (!response.ok || !data.access_token) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(data)}`);
  }

  _cachedToken = data.access_token;
  // Shopify tokens expire in 1 hour; cache 55 min to be safe
  _tokenExpiresAt = now + 55 * 60 * 1000;
  return _cachedToken;
}

function jsonResponse(res, statusCode, body, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(statusCode).json(body);
}

function normalizeOrigin(requestOrigin) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';

  if (allowed === '*') {
    return '*';
  }

  if (!requestOrigin) {
    return allowed;
  }

  return requestOrigin === allowed ? requestOrigin : allowed;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean);
}

function buildSmsConsent(phone, whatsappOptIn) {
  if (!phone || !whatsappOptIn) {
    return null;
  }

  return {
    state: 'subscribed',
    opt_in_level: 'single_opt_in',
    consent_updated_at: new Date().toISOString(),
    consent_collected_from: 'other'
  };
}

async function shopifyRequest(path, method, token, storeDomain, body) {
  const response = await fetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data.errors ? JSON.stringify(data.errors) : `Shopify API error (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function findCustomerByEmail(email, token, storeDomain) {
  const query = encodeURIComponent(`email:${email}`);
  const result = await shopifyRequest(
    `/customers/search.json?query=${query}&fields=id,email,phone,tags`,
    'GET',
    token,
    storeDomain
  );

  if (!result.customers || result.customers.length === 0) {
    return null;
  }

  return result.customers[0];
}

function isPhoneAlreadyTakenError(message) {
  const value = String(message || '').toLowerCase();
  return value.includes('phone') && value.includes('already been taken');
}

function buildPhoneTag(phone) {
  const value = String(phone || '').trim();
  if (!value) return '';
  return `phone:${value}`;
}

function mergeTagString(existingTags, incomingTags) {
  const merged = new Set();

  String(existingTags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => merged.add(tag));

  incomingTags.forEach((tag) => merged.add(tag));

  return Array.from(merged).join(', ');
}

function buildCustomerPayload(input, existingCustomer) {
  const firstName = String(input.firstName || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();
  const whatsappOptIn = Boolean(input.whatsappOptIn);
  const acceptsMarketing = Boolean(input.acceptsMarketing);
  const tags = normalizeTags(input.tags);

  const customer = {
    email,
    first_name: firstName || undefined,
    accepts_marketing: acceptsMarketing,
    tags: mergeTagString(existingCustomer ? existingCustomer.tags : '', tags)
  };

  if (phone) {
    customer.phone = phone;
  }

  if (whatsappOptIn && phone) {
    customer.sms_marketing_consent = buildSmsConsent(phone, true);
  }

  return customer;
}

module.exports = async function handler(req, res) {
  const requestOrigin = req.headers.origin || '';
  const corsOrigin = normalizeOrigin(requestOrigin);

  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 204, {}, corsOrigin);
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' }, corsOrigin);
  }

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!storeDomain || !clientId || !clientSecret) {
    return jsonResponse(
      res,
      500,
      { error: 'Missing SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET environment variable.' },
      corsOrigin
    );
  }

  const body = req.body || {};
  const email = String(body.email || '').trim();

  if (!email) {
    return jsonResponse(res, 400, { error: 'Email is required.' }, corsOrigin);
  }

  try {
    const token = await getShopifyToken(storeDomain, clientId, clientSecret);
    const existingCustomer = await findCustomerByEmail(email, token, storeDomain);
    const customer = buildCustomerPayload(body, existingCustomer);

    if (existingCustomer) {
      const updatePayload = {
        customer: {
          id: existingCustomer.id,
          ...customer
        }
      };

      const updateResult = await shopifyRequest(
        `/customers/${existingCustomer.id}.json`,
        'PUT',
        token,
        storeDomain,
        updatePayload
      );

      return jsonResponse(
        res,
        200,
        {
          ok: true,
          mode: 'updated',
          customerId: updateResult.customer && updateResult.customer.id
        },
        corsOrigin
      );
    }

    const createPayload = { customer };

    try {
      const createResult = await shopifyRequest('/customers.json', 'POST', token, storeDomain, createPayload);

      return jsonResponse(
        res,
        200,
        {
          ok: true,
          mode: 'created',
          customerId: createResult.customer && createResult.customer.id
        },
        corsOrigin
      );
    } catch (createError) {
      const phone = String(body.phone || '').trim();
      if (!phone || !isPhoneAlreadyTakenError(createError.message)) {
        throw createError;
      }

      const fallbackTags = normalizeTags(body.tags);
      const phoneTag = buildPhoneTag(phone);
      if (phoneTag && !fallbackTags.includes(phoneTag)) {
        fallbackTags.push(phoneTag);
      }

      const fallbackInput = {
        ...body,
        phone: '',
        whatsappOptIn: false,
        tags: fallbackTags
      };

      const fallbackCustomer = buildCustomerPayload(fallbackInput, null);
      const fallbackCreatePayload = { customer: fallbackCustomer };
      const fallbackCreateResult = await shopifyRequest('/customers.json', 'POST', token, storeDomain, fallbackCreatePayload);

      return jsonResponse(
        res,
        200,
        {
          ok: true,
          mode: 'created_without_phone_duplicate',
          customerId: fallbackCreateResult.customer && fallbackCreateResult.customer.id
        },
        corsOrigin
      );
    }
  } catch (error) {
    return jsonResponse(res, 500, { error: error.message || 'Unknown server error' }, corsOrigin);
  }
}
