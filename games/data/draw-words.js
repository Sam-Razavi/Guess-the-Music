// Draw It!'s word bank. A word can have other accepted answers after a "/"
// (the first one is what the screens show): spoken and written Persian
// spellings ("هندونه/هندوانه"), synonyms ("Couch/Sofa"). Guesses are compared
// ignoring case, spaces, half-spaces and Arabic-keyboard letter variants.
//
// easy: one thing, quick to draw. hard: a scene, an action or something
// tricky; the drawer can pick one for double points.
// The Persian list is written for an Iranian crowd, not translated.

module.exports = {
  fa: {
    easy: [
      'خورشید', 'ماه', 'ستاره', 'ابر', 'بارون/باران', 'رنگین‌کمان', 'درخت', 'گل', 'کوه', 'دریا', 'ماهی', 'گربه', 'سگ',
      'اسب', 'شتر', 'مرغ', 'خروس', 'جوجه', 'اردک', 'خرگوش', 'لاک‌پشت', 'مار', 'فیل', 'زرافه', 'شیر', 'پروانه',
      'زنبور', 'عنکبوت', 'موز', 'سیب', 'انار', 'هندونه/هندوانه', 'توت‌فرنگی', 'هویج', 'پیتزا', 'بستنی', 'کیک تولد',
      'تخم‌مرغ', 'نون/نان', 'چای', 'سماور', 'قوری', 'استکان', 'قاشق', 'چنگال', 'چتر', 'عینک', 'کلاه', 'کفش',
      'جوراب', 'پیرهن/پیراهن', 'ساعت', 'کلید', 'قفل', 'در', 'پنجره', 'خونه/خانه', 'ماشین/خودرو', 'دوچرخه', 'هواپیما',
      'کشتی', 'قطار', 'اتوبوس', 'موتور/موتورسیکلت', 'توپ', 'بادکنک', 'کادو/هدیه', 'شمع', 'تلفن/گوشی', 'تلویزیون',
      'گیتار', 'تار', 'دف', 'کتاب', 'مداد', 'قیچی', 'صندلی', 'میز', 'تخت', 'مسواک', 'شونه/شانه', 'آینه', 'بالش',
      'قلب', 'دست', 'چشم', 'دماغ/بینی', 'گوش', 'دندون/دندان', 'آدم‌برفی', 'قایق', 'پل', 'چادر مسافرتی/چادر', 'آتیش/آتش',
      'نردبون/نردبان', 'بادبادک', 'تاج', 'روح', 'ربات', 'موشک', 'قلعه', 'لنگر', 'کاکتوس', 'قارچ', 'برگ', 'جغد',
      'هشت‌پا/اختاپوس', 'نهنگ', 'کفشدوزک', 'گوجه/گوجه‌فرنگی', 'بلال', 'لیوان', 'شیشه‌ی شیر', 'جارو', 'سطل',
    ],
    hard: [
      'قلیون/قلیان', 'فرش ایرانی/فرش', 'سفره‌ی هفت‌سین/هفت‌سین', 'چهارشنبه‌سوری', 'برج آزادی', 'تخت جمشید', 'گنبد',
      'دیزی/آبگوشت', 'کباب کوبیده/کباب', 'ته‌دیگ', 'حاجی فیروز', 'چرخ و فلک', 'آسانسور', 'پله‌برقی', 'ترافیک',
      'کف زدن/دست زدن', 'خواب دیدن', 'ماهیگیری', 'اسکی', 'شنا', 'یوگا', 'دندون‌پزشکی/دندانپزشک', 'آرایشگاه',
      'عروسی', 'جشن تولد/تولد', 'کنکور', 'سینما', 'باغ وحش', 'آتش‌نشان', 'پلیس', 'دزد', 'دکتر/پزشک', 'آشپز',
      'فضانورد', 'آدم فضایی', 'دایناسور', 'اژدها', 'پری دریایی', 'زامبی', 'جادوگر', 'آتشفشان', 'طوفان', 'زلزله',
      'ساعت شنی', 'فانوس دریایی', 'دزد دریایی', 'نقشه‌ی گنج', 'قصر شنی', 'سلفی', 'وای‌فای', 'جاروبرقی',
      'ماشین لباسشویی/لباسشویی', 'پیک موتوری', 'خونه‌ی جن‌زده', 'خوابگردی', 'آفتاب‌سوختگی', 'سکسکه', 'شعبده‌باز',
      'تک‌شاخ', 'ماکارونی', 'پاپ‌کورن/ذرت بوداده', 'جوجه‌کباب', 'بستنی سنتی', 'لواشک', 'نوروز', 'سیزده‌بدر',
      'زیر کرسی/کرسی', 'دماوند', 'کویر', 'حموم/حمام', 'تاکسی', 'مترو', 'بازار', 'نونوایی/نانوایی', 'کله‌پاچه',
    ],
  },
  en: {
    easy: [
      'Sun', 'Moon', 'Star', 'Cloud', 'Rain', 'Rainbow', 'Tree', 'Flower', 'Mountain', 'Fish', 'Cat', 'Dog', 'Horse',
      'Camel', 'Chicken/Hen', 'Duck', 'Rabbit/Bunny', 'Turtle', 'Snake', 'Elephant', 'Giraffe', 'Lion', 'Butterfly', 'Bee',
      'Spider', 'Banana', 'Apple', 'Watermelon', 'Strawberry', 'Carrot', 'Pizza', 'Ice cream', 'Birthday cake/Cake',
      'Egg', 'Bread', 'Teapot', 'Cup/Mug', 'Spoon', 'Fork', 'Umbrella', 'Glasses', 'Hat', 'Shoe', 'Sock', 'T-shirt/Shirt',
      'Clock', 'Key', 'Lock', 'Door', 'Window', 'House', 'Car', 'Bicycle/Bike', 'Airplane/Plane', 'Ship', 'Train', 'Bus',
      'Motorcycle/Motorbike', 'Ball', 'Balloon', 'Gift/Present', 'Candle', 'Phone/Mobile', 'TV/Television', 'Guitar',
      'Drum', 'Book', 'Pencil', 'Scissors', 'Chair', 'Table', 'Bed', 'Toothbrush', 'Comb', 'Mirror', 'Pillow', 'Heart',
      'Hand', 'Eye', 'Nose', 'Ear', 'Tooth', 'Snowman', 'Boat', 'Bridge', 'Tent', 'Fire', 'Ladder', 'Kite', 'Crown',
      'Ghost', 'Robot', 'Rocket', 'Castle', 'Anchor', 'Cactus', 'Mushroom', 'Leaf', 'Owl', 'Octopus', 'Whale',
      'Ladybug/Ladybird', 'Tomato', 'Glass', 'Baby bottle', 'Broom', 'Bucket', 'Sofa/Couch', 'Penguin', 'Frog',
    ],
    hard: [
      'Hot-air balloon', 'Roller coaster', 'Ferris wheel', 'Escalator', 'Traffic jam', 'Clapping/Applause', 'Dreaming',
      'Fishing', 'Skiing', 'Swimming', 'Yoga', 'Dentist', 'Haircut', 'Wedding', 'Birthday party', 'Water park', 'Cinema',
      'Zoo', 'Firefighter', 'Police officer/Police', 'Thief/Burglar', 'Doctor', 'Chef/Cook', 'Astronaut', 'Alien',
      'Dinosaur', 'Dragon', 'Mermaid', 'Zombie', 'Wizard', 'Volcano', 'Tornado', 'Earthquake', 'Hourglass', 'Lighthouse',
      'Pirate', 'Treasure map', 'Sandcastle', 'Snow globe', 'Selfie', 'Wi-Fi/Wifi', 'Vacuum cleaner', 'Washing machine',
      'Lawn mower', 'Statue of Liberty', 'Eiffel Tower', 'Pyramids/Pyramid', 'Haunted house', 'Sleepwalking', 'Sunburn',
      'Hiccups', 'Juggling', 'Magician', 'Unicorn', 'Spaghetti', 'Sushi', 'Popcorn', 'Barbecue/BBQ', 'Pizza delivery',
      'Shooting star', 'Waterfall', 'Desert island', 'Snowball fight', 'Bungee jumping', 'Skydiving', 'Camping',
      'Graduation', 'Superhero', 'Vampire', 'Tightrope walker', 'Bubble bath', 'Spider web', 'Scarecrow', 'Igloo',
    ],
  },
};
