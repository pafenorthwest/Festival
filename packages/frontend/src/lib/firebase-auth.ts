import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
	ActionCodeURL,
	type Auth,
	connectAuthEmulator,
	GoogleAuthProvider,
	getAuth,
	isSignInWithEmailLink,
	onIdTokenChanged,
	sendSignInLinkToEmail,
	signInWithEmailLink,
	signInWithPopup,
	signOut,
	type Unsubscribe,
	type User,
	type UserCredential,
} from "firebase/auth";
import { buildFestivalVolunteersPath, buildInvitePath } from "./routes.js";

export type PendingIntent =
	| { kind: "create-org" }
	| { kind: "invite"; inviteToken: string; name: string }
	| { kind: "volunteer"; slug: string; festivalSlug: string };

type SignInIntent = PendingIntent | { kind: "login" };

export class MissingPendingEmailError extends Error {
	constructor() {
		super(
			"This sign-in link was opened in a different browser or device than the one that requested it.",
		);
		this.name = "MissingPendingEmailError";
	}
}

const PENDING_EMAIL_KEY = "festival.pendingEmail";
const PENDING_INTENT_KEY = "festival.pendingIntent";
const ORGANIZER_LOGIN_EMAIL_KEY = "festival.organizerLoginEmail";
const ORGANIZER_LOGIN_CALLBACK = "/?organizer-login=1";

function getFirebaseConfig() {
	const apiKey = import.meta.env.FRONT_FIREBASE_API_KEY;
	const authDomain = import.meta.env.FRONT_FIREBASE_AUTH_DOMAIN;
	const projectId = import.meta.env.FRONT_FIREBASE_PROJECT_ID;
	const appId = import.meta.env.FRONT_FIREBASE_APP_ID;

	if (!apiKey || !authDomain || !projectId || !appId) {
		return null;
	}

	return {
		apiKey,
		authDomain,
		projectId,
		appId,
	};
}

let firebaseApp: FirebaseApp | null | undefined;
let firebaseAuth: Auth | null | undefined;
let emulatorConnected = false;
let credentialSignIn: {
	intent: SignInIntent | null;
	user: Promise<User | null>;
	intentHandled: boolean;
} | null = null;

export function getFirebaseAuth(): Auth | null {
	if (firebaseAuth !== undefined) {
		return firebaseAuth;
	}

	const config = getFirebaseConfig();
	if (!config) {
		firebaseApp = null;
		firebaseAuth = null;
		return null;
	}

	firebaseApp = getApps()[0] ?? initializeApp(config);
	firebaseAuth = getAuth(firebaseApp);

	const emulatorUrl = import.meta.env.FRONT_FIREBASE_AUTH_EMULATOR_URL?.trim();
	if (emulatorUrl && !emulatorConnected) {
		connectAuthEmulator(firebaseAuth, emulatorUrl, { disableWarnings: true });
		emulatorConnected = true;
	}

	return firebaseAuth;
}

function assertAuth(): Auth {
	const auth = getFirebaseAuth();
	if (!auth) {
		throw new Error(
			"Firebase web configuration is missing. Set the required FRONT_FIREBASE_* environment variables.",
		);
	}

	return auth;
}

function savePendingIntent(intent: PendingIntent) {
	localStorage.setItem(PENDING_INTENT_KEY, JSON.stringify(intent));
}

export function readPendingIntent(): PendingIntent | null {
	const raw = localStorage.getItem(PENDING_INTENT_KEY);
	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as PendingIntent;
	} catch {
		return null;
	}
}

export function clearPendingIntent() {
	localStorage.removeItem(PENDING_INTENT_KEY);
	localStorage.removeItem(PENDING_EMAIL_KEY);
}

export function buildEmailLinkUrl(intent: SignInIntent): string {
	if (intent.kind === "login") {
		return `${window.location.origin}${ORGANIZER_LOGIN_CALLBACK}`;
	}
	if (intent.kind === "invite") {
		return `${window.location.origin}${buildInvitePath(intent.inviteToken)}`;
	}
	if (intent.kind === "volunteer") {
		return `${window.location.origin}${buildFestivalVolunteersPath(intent.slug, intent.festivalSlug)}`;
	}

	return `${window.location.origin}/create-organization`;
}

export function pendingCredentialSignIn() {
	return credentialSignIn;
}

async function completeCredentialSignIn(
	request: Promise<UserCredential>,
	intent: SignInIntent | null,
) {
	// An ID token update may occur while an email link is pending or a popup
	// is open. Only a successful credential should dispatch a sign-in intent.
	const attempt = {
		intent,
		intentHandled: false,
		user: request.then(
			({ user }) => user,
			() => null,
		),
	};
	credentialSignIn = attempt;
	try {
		return await request;
	} finally {
		if (credentialSignIn === attempt) credentialSignIn = null;
	}
}

export async function signInWithGoogle(intent: SignInIntent) {
	const auth = assertAuth();
	const provider = new GoogleAuthProvider();
	if (intent.kind === "login") {
		provider.setCustomParameters({ prompt: "select_account" });
	} else {
		savePendingIntent(intent);
	}
	const credential = await completeCredentialSignIn(
		signInWithPopup(auth, provider),
		intent,
	);
	return credential.user;
}

export async function sendPasswordlessEmailLink(input: {
	email: string;
	intent: SignInIntent;
}) {
	const auth = assertAuth();
	if (input.intent.kind === "login") {
		localStorage.setItem(ORGANIZER_LOGIN_EMAIL_KEY, input.email);
	} else {
		localStorage.setItem(PENDING_EMAIL_KEY, input.email);
		savePendingIntent(input.intent);
	}

	await sendSignInLinkToEmail(auth, input.email, {
		url: buildEmailLinkUrl(input.intent),
		handleCodeInApp: true,
	});
}

export function isOrganizerLoginEmailLink(href: string): boolean {
	const link = ActionCodeURL.parseLink(href);
	if (link?.operation !== "EMAIL_SIGNIN") return false;

	try {
		const currentUrl = new URL(href);
		const isLoginCallback = (url: URL) =>
			url.origin === currentUrl.origin &&
			url.pathname === "/" &&
			url.searchParams.get("organizer-login") === "1";
		return (
			isLoginCallback(currentUrl) ||
			(link.continueUrl !== null && isLoginCallback(new URL(link.continueUrl)))
		);
	} catch {
		return false;
	}
}

function readEmailLinkIntent(href: string): SignInIntent | null {
	return isOrganizerLoginEmailLink(href)
		? { kind: "login" }
		: readPendingIntent();
}

async function finishEmailLinkSignIn(
	auth: Auth,
	email: string,
	href: string,
	intent: SignInIntent | null,
) {
	const credential = await completeCredentialSignIn(
		signInWithEmailLink(auth, email, href),
		intent,
	);
	if (intent?.kind === "login") {
		localStorage.removeItem(ORGANIZER_LOGIN_EMAIL_KEY);
		window.history.replaceState(window.history.state, "", "/");
	}
	return { intent, user: credential.user };
}

export async function completePasswordlessEmailLinkSignIn() {
	const auth = getFirebaseAuth();
	if (!auth) {
		return null;
	}
	const href = window.location.href;
	if (!isSignInWithEmailLink(auth, href)) {
		return null;
	}

	const intent = readEmailLinkIntent(href);
	const email = localStorage.getItem(
		intent?.kind === "login" ? ORGANIZER_LOGIN_EMAIL_KEY : PENDING_EMAIL_KEY,
	);
	if (!email) {
		throw new MissingPendingEmailError();
	}

	return finishEmailLinkSignIn(auth, email, href, intent);
}

export async function completeEmailLinkSignInWithEmail(email: string) {
	const auth = assertAuth();
	const href = window.location.href;
	const intent = readEmailLinkIntent(href);
	if (intent?.kind !== "login") localStorage.setItem(PENDING_EMAIL_KEY, email);
	return finishEmailLinkSignIn(auth, email, href, intent);
}

export function subscribeToAuthChanges(
	listener: Parameters<typeof onIdTokenChanged>[1],
): Unsubscribe {
	const auth = getFirebaseAuth();
	if (!auth) {
		return () => {};
	}

	return onIdTokenChanged(auth, listener);
}

export async function logoutCurrentUser() {
	const auth = getFirebaseAuth();
	if (auth) {
		await signOut(auth);
	}
	clearPendingIntent();
	localStorage.removeItem(ORGANIZER_LOGIN_EMAIL_KEY);
}
