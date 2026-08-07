/**
 * Email validation & disposable domain detection.
 * Dùng danh sách tĩnh các domain email tạm phổ biến nhất.
 * Cập nhật định kỳ từ: https://github.com/disposable-email-domains/disposable-email-domains
 */

// ~150 domain email tạm phổ biến nhất
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '10minutemail.com', '10minutemail.info', '20minutemail.com',
  '33mail.com', '3mail.ga', '4mail.cf', '4mail.ga', '60minutemail.com',
  'abandonmail.com', 'airmailbox.com', 'amail.club', 'amail.com',
  'anonymbox.com', 'antichef.com', 'antispam.de', 'armyspy.com',
  'artdrip.com', 'bcaoo.com', 'binkmail.com', 'bobmail.info',
  'boun.cr', 'brennendesreich.de', 'bugmenot.com', 'byom.de',
  'cartelera.org', 'chammy.info', 'cheatmail.de', 'clrmail.com',
  'cobarekyo1.site', 'courrieltemporaire.com', 'crapmail.org',
  'cuvox.de', 'dacoolest.com', 'dandikmail.com', 'dayrep.com',
  'deadaddress.com', 'despam.it', 'devnullmail.com', 'dfgh.net',
  'digitalsanctuary.com', 'discard.email', 'discardmail.com',
  'discardmail.de', 'disposable-email.ml', 'dispose.it',
  'dispostable.com', 'dodgeit.com', 'dodsi.com', 'dontsendmespam.de',
  'dropmail.me', 'dump-email.info', 'dumpmail.de', 'e4ward.com',
  'email-fake.com', 'email60.com', 'emailondeck.com', 'emailtemporanea.com',
  'emailtemporar.ro', 'emkei.cz', 'emltmp.com', 'etranquil.com',
  'fakeinbox.com', 'fakeinformation.com', 'fakemail.fr', 'fakemailgenerator.com',
  'fastacura.com', 'fastchevy.com', 'fastchrysler.com', 'fastkawasaki.com',
  'fastmazda.com', 'fastmitsubishi.com', 'fastnissan.com', 'fastsubaru.com',
  'fastsuzuki.com', 'fasttoyota.com', 'fastyamaha.com', 'filzmail.com',
  'fivemail.de', 'fleckens.hu', 'flemail.ru', 'flyspam.com',
  'freundin.ru', 'fux0ringduh.com', 'garliclife.com', 'getairmail.com',
  'getnada.com', 'ghosttexter.de', 'great-host.in', 'greensloth.com',
  'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.org', 'gustr.com', 'harakirimail.com',
  'hidzz.com', 'hmamail.com', 'hopemail.biz', 'ieatspam.eu',
  'ieatspam.info', 'imails.info', 'inbox.si', 'incognitomail.com',
  'insorg-mail.info', 'jetable.org', 'junk.to', 'kasmail.com',
  'klassmaster.com', 'klzlk.com', 'koszmail.pl', 'kurzepost.de',
  'linshiyouxiang.net', 'mail-temporaire.fr', 'mail.by', 'mail.mezimages.net',
  'mail114.com', 'mail1a.de', 'mail21.cc', 'mail3.dk', 'mail3.ga',
  'mail3.ml', 'mail333.com', 'mail4.ga', 'mail4.ml', 'mail5.ga',
  'mail5.ml', 'mail6.ga', 'mail6.ml', 'mail7.ga', 'mail7.io',
  'mail8.ga', 'mail8.ml', 'mail9.ga', 'mail9.ml', 'maildax.com',
  'maildrop.cc', 'mailforspam.com', 'mailfreeonline.com', 'mailimate.com',
  'mailin8r.com', 'mailinator.com', 'mailinator2.com', 'mailincubator.com',
  'mailismagic.com', 'mailmoat.com', 'mailnator.com', 'mailnesia.com',
  'mailnull.com', 'mailpick.biz', 'mailrock.biz', 'mailscrap.com',
  'mailtemp.fr', 'mailtemp.info', 'mailtemporaire.com', 'mailtome.de',
  'mailzi.ru', 'mailzilla.com', 'mbx.cc', 'mega.zik.dj', 'meinspamschutz.com',
  'meltmail.com', 'messagebeamer.de', 'mintemail.com', 'mohmal.com',
  'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'msa.minsmail.com',
  'mt2009.com', 'mx0.wwwnew.eu', 'my10minutemail.com', 'mycleaninbox.net',
  'mypartyclip.de', 'myphantomemail.com', 'mysamp.de', 'mytemp.email',
  'mytempemail.com', 'mytempmail.com', 'nepwk.com', 'netmails.com',
  'netzidiot.de', 'nincsmail.com', 'no-spam.ws', 'noblepioneer.com',
  'nomail.pw', 'nospam.ze.tc', 'nospam4.us', 'nospamfor.us',
  'nospammail.net', 'notmailinator.com', 'nowmymail.com', 'nurfuerspam.de',
  'obfusko.com', 'objectmail.com', 'obobbo.com', 'onewaymail.com',
  'online.ms', 'oopi.org', 'opayq.com', 'ordinaryamerican.net',
  'otherinbox.com', 'ovpn.com', 'owlpic.com', 'pimpedup.de',
  'pjjkp.com', 'pookmail.com', 'privacy.net', 'proxymail.eu',
  'punkass.com', 'put2.net', 'quickinbox.com', 'rcpt.at',
  'recode.me', 'regbypass.com', 'rmqkr.net', 'rtrtr.com',
  's0ny.net', 'safe-mail.net', 'sandelf.de', 'saynotospams.com',
  'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com',
  'shiftmail.com', 'shitmail.org', 'shortmail.net', 'sibmail.com',
  'skeefmail.com', 'slapsfromlastnight.com', 'smellfear.com', 'snakemail.com',
  'sneakemail.com', 'sneakmail.de', 'sofort-mail.de', 'solvemail.info',
  'spam.la', 'spam.su', 'spam4.me', 'spamavert.com', 'spambob.com',
  'spambog.com', 'spambox.us', 'spamcannon.com', 'spamcero.com',
  'spamcon.org', 'spamcorptastic.com', 'spamcowboy.com', 'spamday.com',
  'spamex.com', 'spamfighter.cf', 'spamfighter.ga', 'spamfighter.ml',
  'spamfree.eu', 'spamgoes.in', 'spamgourmet.com', 'spamherelots.com',
  'spamhole.com', 'spamify.com', 'spaminator.de', 'spamkill.info',
  'spaml.com', 'spammotel.com', 'spamobox.com', 'spamoff.de',
  'spamsalad.in', 'spamstack.net', 'spamtrail.com', 'spamtrap.ro',
  'speed.1s.fr', 'supergreatmail.com', 'supermailer.jp', 'suremail.info',
  'teewars.org', 'teleworm.com', 'temp-mail.org', 'temp.email.neu',
  'tempail.com', 'tempemail.biz', 'tempmail.com', 'tempmail.de',
  'tempmail.eu', 'tempmail.it', 'tempmail.pro', 'tempmail.us',
  'tempomail.fr', 'temporarily.de', 'temporaryemail.us', 'temporarymailaddress.com',
  'tempsky.com', 'thankyou2010.com', 'thc.st', 'thisisnotmyrealemail.com',
  'throwaway.email', 'tilien.com', 'tmail.com', 'tmailinator.com',
  'tmpeml.com', 'tmpjr.me', 'toxinam.com', 'trash-amil.com',
  'trash-mail.at', 'trash-mail.com', 'trash-mail.de', 'trash2009.com',
  'trashemail.de', 'trashmail.at', 'trashmail.com', 'trashmailer.com',
  'trashymail.com', 'trialmail.de', 'twinmail.de', 'tyldd.com',
  'uggsrock.com', 'umail.net', 'uroid.com', 'veryrealemail.com',
  'vidchart.com', 'vomoto.com', 'vpn.st', 'vsimcard.com',
  'vubby.com', 'wallet.com', 'webm4il.info', 'wegwerf-email.de',
  'wegwerfmail.de', 'wegwerfmail.net', 'wh4f.org', 'whyspam.me',
  'willselfdestruct.com', 'winemaven.info', 'wronghead.com', 'wuzup.net',
  'xagloo.com', 'xemaps.com', 'xents.com', 'xmaily.com',
  'xoxy.net', 'yep.it', 'yogamaven.com', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'yopmail.org', 'ypmail.webarnak.fr.eu.org',
  'yuurok.com', 'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com',
  'zoemail.org',
]);

/**
 * Kiểm tra email có phải domain dùng một lần không.
 * @param {string} email
 * @returns {boolean} true nếu là disposable email
 */
export function isDisposableEmail(email) {
  const domain = String(email).trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}

/**
 * Validate email format cơ bản.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  const trimmed = String(email).trim();
  // Regex chuẩn: không quá 254 ký tự, có @ và domain hợp lệ
  if (trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

/**
 * Lấy domain từ email.
 * @param {string} email
 * @returns {string|null}
 */
export function getEmailDomain(email) {
  const domain = String(email).trim().toLowerCase().split('@')[1];
  return domain || null;
}
