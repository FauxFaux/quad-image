// e/UVsA2KAc3n.png
export type ImageId = string;

// green!battery staple
export type GallerySecret = string;

// green:z25E-PzBTg
export type GalleryPub = string;

export const plausibleGallerySecret = (secret: GallerySecret) =>
  /^([a-zA-Z][a-zA-Z0-9]{3,9})!(.{4,99})$/.test(secret);

const vowels = 'aeiouhy';
const consonants = 'bcdfgjklmnpqrstvwxz';

export function generateGallerySecret(): GallerySecret {
  const random = crypto.getRandomValues(new Uint8Array(32));
  let randomIndex = 0;
  const startsWithVowel = random[0] % 2 === 0;
  randomIndex++;
  const password: string[] = [];
  let useVowel = startsWithVowel;
  while (password.length < 10) {
    const alphabet = useVowel ? vowels : consonants;
    const runLength = useVowel ? 1 + (random[randomIndex++] % 3) : 1;
    for (let offset = 0; offset < runLength && password.length < 10; offset++) {
      password.push(alphabet[random[randomIndex++] % alphabet.length]);
    }
    useVowel = !useVowel;
  }

  const capitalCount = 1 + (random[randomIndex++] % 2);
  const firstCapital = random[randomIndex++] % password.length;
  password[firstCapital] = password[firstCapital].toUpperCase();
  if (capitalCount === 2) {
    const secondCapital =
      (firstCapital + 1 + (random[randomIndex] % (password.length - 1))) %
      password.length;
    password[secondCapital] = password[secondCapital].toUpperCase();
  }

  return `anon!${password.join('')}`;
}
