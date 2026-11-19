// Xac minh token dang nhap Google / Facebook phia server.
// Tra ve { providerId, email, name, avatar } hoac nem HttpError 401.
const { HttpError } = require('./errors');

const invalid = (msg) => new HttpError(401, 'social_token_invalid', msg);

function createSocialVerifier({ googleClientIds = [], facebookAppId, fetchFn = fetch } = {}) {
  async function getJson(url) {
    const res = await fetchFn(url);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function google(idToken) {
    if (!googleClientIds.length) throw new HttpError(503, 'social_not_configured', 'Dang nhap Google chua duoc cau hinh');
    const { ok, data } = await getJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!ok || !data.sub) throw invalid('Token Google khong hop le');
    if (!googleClientIds.includes(data.aud)) throw invalid('Token Google khong danh cho ung dung nay');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(data.iss)) throw invalid('Token Google sai nguon phat hanh');
    if (data.email_verified !== 'true' && data.email_verified !== true) throw invalid('Email Google chua duoc xac minh');
    return { providerId: data.sub, email: data.email, name: data.name, avatar: data.picture };
  }

  async function facebook(accessToken) {
    if (!facebookAppId) throw new HttpError(503, 'social_not_configured', 'Dang nhap Facebook chua duoc cau hinh');
    const t = encodeURIComponent(accessToken);
    // Token phai duoc cap cho dung app cua minh
    const app = await getJson(`https://graph.facebook.com/app?access_token=${t}`);
    if (!app.ok || String(app.data.id) !== String(facebookAppId)) throw invalid('Token Facebook khong danh cho ung dung nay');
    const me = await getJson(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${t}`);
    if (!me.ok || !me.data.id) throw invalid('Token Facebook khong hop le');
    return { providerId: me.data.id, email: me.data.email || null, name: me.data.name, avatar: me.data.picture?.data?.url };
  }

  return {
    verify(provider, token) {
      if (typeof token !== 'string' || token.length < 10) throw new HttpError(400, 'validation_error', 'Thieu token');
      if (provider === 'google') return google(token);
      if (provider === 'facebook') return facebook(token);
      throw new HttpError(400, 'validation_error', "provider phai la 'google' hoac 'facebook'");
    },
    configured: { google: googleClientIds.length > 0, facebook: !!facebookAppId },
  };
}

module.exports = { createSocialVerifier };
