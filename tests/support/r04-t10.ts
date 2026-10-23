// Shared data of the tests of the sample trees 17 to 19 (the release plan T10, version 0.4): same-sex couples, names in many scripts, right-to-left names.
// Every expected value below is written by hand from the sample trees and the spec. No value is read back from the plugin.
import { readFileSync } from 'node:fs';
import { topLevelBlocks } from '../acceptance/load';

/** The three new sample trees: the id of the file, its file name and the people that the note must hold. */
export interface T10Tree {
	id: '17' | '18' | '19';
	file: string;
	/** Person id -> name exactly as the note writes it (no normalisation), then the sobriquet if the note has one. */
	people: Record<string, { name: string; sobriquet?: string; born?: string }>;
	houses: string[];
}

export const T10: readonly T10Tree[] = [
	{
		id: '17',
		file: '17-same-sex.md',
		houses: ['marrow', 'orme', 'fenn'],
		people: {
			edda: { name: 'Edda Marrow', born: '1040' },
			lisbet: { name: 'Lisbet Orme', born: '1042' },
			anselm: { name: 'Anselm Vale', born: '1036' },
			hale: { name: 'Hale Marrow', born: '1060' },
			wren: { name: 'Wren Marrow', born: '1066' },
			merrin: { name: 'Merrin Orme', born: '1068' },
			tobias: { name: 'Tobias Orme', born: '1070' },
			dario: { name: 'Dario Fenn', born: '1068' },
			ysolt: { name: 'Ysolt Quill', born: '1062' },
			brenna: { name: 'Brenna Cray', born: '1070' },
			garrick: { name: 'Garrick Marrow', born: '1086' },
			piers: { name: 'Piers Vane', born: '1084' },
			nell: { name: 'Nell Marrow', born: '1115' },
			calla: { name: 'Calla Rooke', born: '1068' },
			pia: { name: 'Pia Marrow', born: '1095' },
			'fenn-rooke': { name: 'Fenn Rooke', born: '1098' },
		},
	},
	{
		id: '18',
		file: '18-non-latin.md',
		houses: ['kalligeri', 'zarev', 'beridze', 'shen', 'sakurai', 'yun', 'vardhan', 'suwan'],
		people: {
			nikolaos: { name: 'Νικόλαος Καλλιγέρης', sobriquet: 'ο Σοφός', born: 'περ. 1102' },
			miroslava: { name: 'Мирослава Заревая', born: 'ок. 1110' },
			alexandra: { name: 'Αλεξάνδρα Καλλιγέρη', born: 'περ. 1131' },
			yaroslav: { name: 'Ярослав Зарев', sobriquet: '🦊 Лис', born: 'ок. 1133' },
			theodoros: { name: 'Θεόδωρος Καλλιγέρης', born: '1135' },
			giorgi: { name: 'გიორგი ბერიძე', born: '1128 წ.' },
			mingxia: { name: '沈明華', born: '1136年' },
			somying: { name: 'สมหญิง สุวรรณ', born: 'พ.ศ. 1138' },
			nana: { name: 'ნანა ბერიძე', born: '1154 წ.' },
			ruolan: { name: '沈若蘭', born: '1158年' },
			dmitri: { name: 'Дмитрий Зарев', born: 'ок. 1160' },
			ouyang: { name: '欧阳慕容诸葛上官东方夏侯司徒令狐', born: '1161年' },
			'thai-long': { name: 'สุวรรณภูมิพัฒนาวงศ์เจริญสุขสันต์ศรีสวัสดิ์มงคลชัย', born: 'พ.ศ. 1162' },
			ken: { name: '桜井健', born: '1150年' },
			minjun: { name: '윤민준', born: '1156년' },
			ananya: { name: 'अनन्या वर्धन', born: '११६२' },
			hinata: { name: '桜井ひなた', born: '1178年' },
			maria: { name: 'マリア桜井', born: '1180年' },
			// "Zoe" and the separate mark U+0308 (the decomposed form), then a person with a skin tone and a joiner (U+1F9D1 U+1F3FD U+200D U+1F33E).
			zoe: { name: 'Zoe\u0308 Beridze', sobriquet: '\u{1F9D1}\u{1F3FD}\u200d\u{1F33E} the Farmer', born: '1182' },
			seoyeon: { name: '윤서연', born: '1182년' },
			haneul: { name: '윤하늘', born: '1185년' },
			aryan: { name: 'आर्यन वर्धन', born: '११८४' },
		},
	},
	{
		id: '19',
		file: '19-right-to-left.md',
		houses: ['haddad', 'levi', 'mansour'],
		people: {
			yusuf: { name: 'يوسف الحداد', sobriquet: 'الحكيم', born: '1100' },
			fatima: { name: 'فاطمة بنت خليل', born: 'حوالي 1108' },
			layla: { name: 'ليلى Haddad', born: '1131' },
			omar: { name: 'عمر الحداد', born: '١١٣٣' },
			// The vowel marks are separate code points: U+064F, U+064E, U+064E, U+0651.
			muhammad: { name: 'مُحَمَّد الحداد', born: '1135' },
			david: { name: 'דוד לוי', sobriquet: 'הצעיר', born: 'בערך 1105' },
			// The vowel marks are separate code points: U+05B8, U+05C1, U+05B8, U+05B5, U+05B4.
			sarah: { name: 'שָׁרָה לֵוִי', born: '1110' },
			miriam: { name: 'מרים לוי', born: '1136' },
			avi: { name: 'Avi אבי Cohen', born: '1138' },
			kareem: { name: 'كريم Mansour', born: '1128' },
			salma: { name: 'سلمى Mansour', born: '1158' },
			nur: { name: 'نور الدين الثاني (Nur al-Din II)', born: '1160' },
			rachel: { name: 'רחל (Rachel) לוי-Haddad', born: '1162' },
		},
	},
];

/** The whole note of a new sample tree, exactly as stored. */
export const noteOf = (t: T10Tree): string => readFileSync(`fixtures/${t.file}`, 'utf8');

/** The body of the first kin block of the note. */
export const bodyOf = (t: T10Tree): string => topLevelBlocks(noteOf(t))[0];
