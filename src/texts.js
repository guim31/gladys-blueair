// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, command and
// scene action errors. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './blueair/errors.js';

export const LANGUAGE_FALLBACK = 'en';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  notConfigured: {
    en: 'Enter the e-mail and password of your Blueair account in the configuration.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Blueair dans la configuration.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Blueair-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta Blueair en la configuración.',
  },
  noDevices: {
    en: 'Connected, but the account has no device: check the region.',
    fr: 'Connecté, mais le compte n’a aucun appareil : vérifiez la région.',
    de: 'Verbunden, aber das Konto hat kein Gerät: Prüfe die Region.',
    es: 'Conectado, pero la cuenta no tiene ningún dispositivo: compruebe la región.',
  },
};

// One short explanation per error kind (src/blueair/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'e-mail or password refused by Blueair',
    fr: 'e-mail ou mot de passe refusé par Blueair',
    de: 'E-Mail oder Passwort von Blueair abgelehnt',
    es: 'correo electrónico o contraseña rechazados por Blueair',
  },
  [ERROR_KINDS.LOCKED]: {
    en: 'account locked by Blueair after too many attempts: wait, then check it in the app',
    fr: 'compte bloqué par Blueair après trop de tentatives : patientez, puis vérifiez-le dans l’appli',
    de: 'Konto nach zu vielen Versuchen von Blueair gesperrt: Warte und prüfe es dann in der App',
    es: 'cuenta bloqueada por Blueair tras demasiados intentos: espere y compruébela en la aplicación',
  },
  [ERROR_KINDS.REGISTRATION]: {
    en: 'open the Blueair app once and complete your profile (name)',
    fr: 'ouvrez une fois l’appli Blueair et complétez votre profil (nom)',
    de: 'Öffne einmal die Blueair-App und vervollständige dein Profil (Name)',
    es: 'abra una vez la aplicación Blueair y complete su perfil (nombre)',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the Blueair cloud does not answer',
    fr: 'le cloud Blueair ne répond pas',
    de: 'die Blueair-Cloud antwortet nicht',
    es: 'la nube de Blueair no responde',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests, Blueair asks to slow down: retrying in 10 minutes',
    fr: 'trop de requêtes, Blueair demande de ralentir : nouvel essai dans 10 minutes',
    de: 'zu viele Anfragen, Blueair bittet um Pause: neuer Versuch in 10 Minuten',
    es: 'demasiadas solicitudes, Blueair pide reducir el ritmo: nuevo intento en 10 minutos',
  },
  [ERROR_KINDS.SESSION]: {
    en: 'the Blueair session was refused, see the logs',
    fr: 'la session Blueair a été refusée, voir les logs',
    de: 'die Blueair-Sitzung wurde abgelehnt, sieh in den Protokollen nach',
    es: 'la sesión de Blueair ha sido rechazada, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer from Blueair, see the logs',
    fr: 'réponse inattendue de Blueair, voir les logs',
    de: 'unerwartete Antwort von Blueair, sieh in den Protokollen nach',
    es: 'respuesta inesperada de Blueair, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    account: (count) => `Blueair account: connected, ${count} device(s)`,
    legacy: (count) => `Older Blueair cloud: ${count} device(s)`,
    readOnly: 'read only',
    offline: 'offline',
  },
  fr: {
    account: (count) => `Compte Blueair : connecté, ${count} appareil(s)`,
    legacy: (count) => `Ancien cloud Blueair : ${count} appareil(s)`,
    readOnly: 'lecture seule',
    offline: 'hors ligne',
  },
  de: {
    account: (count) => `Blueair-Konto: verbunden, ${count} Gerät(e)`,
    legacy: (count) => `Ältere Blueair-Cloud: ${count} Gerät(e)`,
    readOnly: 'nur lesen',
    offline: 'offline',
  },
  es: {
    account: (count) => `Cuenta Blueair: conectada, ${count} dispositivo(s)`,
    legacy: (count) => `Nube antigua de Blueair: ${count} dispositivo(s)`,
    readOnly: 'solo lectura',
    offline: 'desconectado',
  },
};

// Errors of the commands, scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  unknownDevice: {
    en: 'This Blueair device is no longer on the account.',
    fr: 'Cet appareil Blueair n’est plus sur le compte.',
    de: 'Dieses Blueair-Gerät ist nicht mehr im Konto.',
    es: 'Este dispositivo Blueair ya no está en la cuenta.',
  },
  readOnly: {
    en: 'This device heats: Gladys only reads it, use the Blueair app.',
    fr: 'Cet appareil chauffe : Gladys le lit seulement, utilisez l’appli Blueair.',
    de: 'Dieses Gerät heizt: Gladys liest es nur, verwende die Blueair-App.',
    es: 'Este dispositivo calienta: Gladys solo lo lee, use la aplicación Blueair.',
  },
  unsupported: {
    en: 'This device does not offer this setting.',
    fr: 'Cet appareil ne propose pas ce réglage.',
    de: 'Dieses Gerät bietet diese Einstellung nicht.',
    es: 'Este dispositivo no ofrece este ajuste.',
  },
  noDevice: {
    en: 'No Blueair device can take this mode.',
    fr: 'Aucun appareil Blueair ne peut prendre ce mode.',
    de: 'Kein Blueair-Gerät kann diesen Modus übernehmen.',
    es: 'Ningún dispositivo Blueair puede adoptar este modo.',
  },
  notConnected: {
    en: 'The Blueair account is not connected: see the configuration.',
    fr: 'Le compte Blueair n’est pas connecté : voir la configuration.',
    de: 'Das Blueair-Konto ist nicht verbunden: Sieh in der Konfiguration nach.',
    es: 'La cuenta Blueair no está conectada: consulte la configuración.',
  },
};

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object built by a function of the language. */
export const perLanguage = (build) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, build(language)]));
