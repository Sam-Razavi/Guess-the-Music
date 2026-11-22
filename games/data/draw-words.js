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
      // animals
      'میمون', 'خرس', 'گرگ', 'روباه', 'گاو', 'گوسفند', 'بز', 'موش', 'سنجاب', 'پنگوئن', 'کانگورو', 'کرگدن',
      'اسب‌آبی/اسب آبی', 'تمساح', 'طوطی', 'کلاغ', 'کبوتر', 'عقاب', 'طاووس', 'حلزون', 'مورچه', 'مگس', 'پشه',
      'خرچنگ', 'کوسه', 'ستاره‌ی دریایی/ستاره دریایی', 'دلفین', 'قورباغه', 'خفاش', 'شترمرغ', 'گورخر', 'ماهی قرمز',
      // food
      'سیب‌زمینی', 'پیاز', 'سیر', 'خیار', 'بادمجون/بادمجان', 'فلفل', 'کدو', 'هلو', 'گیلاس', 'انگور', 'پرتقال',
      'لیمو', 'آناناس', 'نارگیل', 'خرما', 'گردو', 'شکلات', 'آبنبات/آب‌نبات', 'پاستیل', 'دونات', 'ساندویچ',
      'همبرگر', 'هات‌داگ/هات داگ', 'سوسیس', 'پنیر', 'عسل', 'بیسکوییت/کلوچه',
      // around the house
      'لامپ', 'پنکه', 'کولر', 'یخچال', 'اتو', 'قابلمه', 'ماهیتابه', 'بشقاب', 'کاسه', 'کتری', 'نمکدون/نمکدان',
      'چاقو', 'گلدون/گلدان', 'نیمکت', 'دودکش', 'نرده/حصار', 'جعبه', 'شمعدون/شمعدان', 'دستمال کاغذی',
      // things you carry or wear
      'کمربند', 'دستکش', 'شال‌گردن/شال', 'کیف', 'کوله‌پشتی/کوله', 'چمدون/چمدان', 'کیف پول', 'انگشتر', 'گردنبند',
      'گوشواره', 'ساعت مچی', 'کراوات', 'پاپیون', 'دمپایی', 'چکمه', 'شلوار', 'دامن', 'روسری',
      // school, office, tools
      'پاک‌کن', 'خط‌کش', 'دفتر', 'تخته‌سیاه/تخته', 'کره‌ی زمین/کره زمین', 'نقشه', 'پرچم', 'پاکت نامه/نامه',
      'تمبر', 'سکه', 'اسکناس/پول', 'باتری', 'هدفون', 'لپ‌تاپ', 'کیبورد', 'دوربین', 'میکروفون', 'ماشین‌حساب',
      'چکش', 'میخ', 'پیچ‌گوشتی', 'اره', 'تبر', 'بیل', 'آچار', 'طناب', 'چراغ‌قوه', 'ذره‌بین', 'آهنربا',
      'چسب', 'دکمه', 'سوزن', 'قلم‌مو', 'شمشیر', 'سپر', 'جام/کاپ', 'مدال', 'تاس', 'الماس',
      // music and toys
      'پیانو', 'ویولن', 'طبل', 'شیپور', 'سوت', 'زنگ', 'تاب', 'سرسره', 'الاکلنگ', 'عروسک', 'خرس عروسکی',
      'فرفره', 'تیله', 'یویو',
      // outside and getting around
      'برف', 'رعد و برق/صاعقه', 'جزیره', 'رودخونه/رودخانه', 'آبشار', 'غار', 'جنگل', 'چراغ راهنمایی',
      'هلیکوپتر', 'آمبولانس', 'تراکتور', 'کامیون', 'زیردریایی', 'اسکیت‌برد/اسکیت', 'چرخ', 'فرمون/فرمان',
      'ویلچر/صندلی چرخدار', 'عصا',
      // body
      'پا', 'زبون/زبان', 'لب', 'مو', 'سبیل', 'ریش', 'ابرو', 'استخون/استخوان', 'جمجمه', 'مغز',
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
      // sports and games
      'فوتبال', 'والیبال', 'بسکتبال', 'تنیس', 'بوکس', 'پینگ‌پنگ/پینگ پنگ', 'کشتی گرفتن/کشتی‌گیری', 'کوهنوردی',
      'دوچرخه‌سواری', 'اسب‌سواری', 'موج‌سواری', 'چتربازی', 'وزنه‌برداری', 'شطرنج', 'تخته‌نرد', 'منچ',
      'پاسور/ورق‌بازی', 'قایم‌باشک', 'طناب‌بازی', 'لی‌لی',
      // doing things
      'پیک‌نیک', 'عکس گرفتن', 'رقصیدن/رقص', 'آواز خوندن/آواز خواندن', 'خروپف', 'عطسه', 'خمیازه', 'گریه',
      'عاشق شدن/عاشق', 'دعوا', 'خواستگاری', 'سفره‌ی عقد/عقد', 'اسباب‌کشی', 'خرید', 'مهمونی/مهمانی', 'آتش‌بازی',
      'پارک کردن', 'جریمه',
      // places
      'پارک', 'بیمارستان', 'مدرسه', 'دانشگاه', 'فرودگاه', 'پمپ بنزین', 'رستوران', 'کتابخونه/کتابخانه', 'موزه',
      'استادیوم', 'زندان', 'سیرک', 'شهربازی', 'مزرعه', 'آسمون‌خراش/آسمان‌خراش', 'برج میلاد', 'سی‌وسه‌پل/سی و سه پل',
      'برج ایفل', 'مجسمه‌ی آزادی',
      // people and characters
      'کشاورز', 'خلبان', 'معلم', 'نقاش', 'خواننده', 'بازیگر', 'فوتبالیست', 'پستچی', 'سرباز', 'پادشاه/شاه',
      'ملکه', 'شاهزاده', 'نینجا', 'کابوی', 'مومیایی', 'رستم', 'دیو', 'سیمرغ', 'غول چراغ جادو/غول', 'فرش پرنده',
      'علاءالدین/علادین', 'سفید برفی', 'سیندرلا', 'شنل قرمزی', 'پینوکیو', 'بابانوئل', 'خون‌آشام/دراکولا',
      // Iranian food and traditions
      'آش رشته/آش', 'قرمه‌سبزی', 'فسنجون/فسنجان', 'زولبیا بامیه/زولبیا', 'سنگک', 'شله‌زرد', 'سمنو', 'باقلوا',
      'فالوده', 'گز', 'سوهان', 'شب یلدا/یلدا', 'آجیل', 'سنتور', 'کمانچه', 'تنبک/تمبک', 'سوشی',
      // machines and space
      'چرخ خیاطی', 'چرخ گوشت', 'ماشین ظرفشویی/ظرفشویی', 'مایکروویو', 'تردمیل', 'خورشیدگرفتگی/کسوف',
      'ماه‌گرفتگی/خسوف', 'سیاه‌چاله', 'منظومه‌ی شمسی', 'بشقاب‌پرنده', 'سفینه‌ی فضایی/سفینه', 'ماشین زمان',
      'بهمن', 'تایتانیک',
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
      // animals
      'Monkey', 'Bear', 'Wolf', 'Fox', 'Cow', 'Sheep', 'Goat', 'Pig', 'Mouse', 'Squirrel', 'Kangaroo',
      'Rhino/Rhinoceros', 'Hippo/Hippopotamus', 'Crocodile/Alligator', 'Parrot', 'Crow', 'Pigeon/Dove', 'Eagle',
      'Peacock', 'Snail', 'Ant', 'Fly', 'Mosquito', 'Crab', 'Shark', 'Starfish', 'Dolphin', 'Bat', 'Ostrich', 'Zebra',
      'Goldfish',
      // food
      'Potato', 'Onion', 'Garlic', 'Cucumber', 'Eggplant/Aubergine', 'Pepper', 'Pumpkin', 'Peach', 'Cherry',
      'Grapes/Grape', 'Orange', 'Lemon', 'Pineapple', 'Coconut', 'Peanut', 'Chocolate', 'Candy/Sweets',
      'Lollipop', 'Donut/Doughnut', 'Sandwich', 'Hamburger/Burger', 'Hot dog/Hotdog', 'Sausage', 'Cheese', 'Honey',
      'Cookie/Biscuit', 'French fries/Fries/Chips',
      // around the house
      'Light bulb/Lightbulb/Bulb', 'Lamp', 'Fan', 'Fridge/Refrigerator', 'Iron', 'Pot/Saucepan', 'Frying pan/Pan',
      'Plate', 'Bowl', 'Kettle', 'Knife', 'Vase', 'Bench', 'Chimney', 'Fence', 'Box', 'Candlestick', 'Bathtub/Bath',
      'Toilet', 'Doorbell',
      // things you carry or wear
      'Belt', 'Gloves/Glove', 'Scarf', 'Handbag/Bag/Purse', 'Backpack/Rucksack', 'Suitcase', 'Wallet', 'Ring',
      'Necklace', 'Earring/Earrings', 'Watch', 'Tie/Necktie', 'Bow tie', 'Slippers/Slipper', 'Boots/Boot',
      'Pants/Trousers', 'Skirt', 'Dress',
      // school, office, tools
      'Eraser/Rubber', 'Ruler', 'Notebook', 'Globe', 'Map', 'Flag', 'Envelope/Letter', 'Stamp', 'Coin', 'Money/Cash',
      'Battery', 'Headphones', 'Laptop', 'Keyboard', 'Camera', 'Microphone/Mic', 'Calculator', 'Hammer', 'Nail',
      'Screwdriver', 'Saw', 'Axe/Ax', 'Shovel/Spade', 'Wrench/Spanner', 'Rope', 'Flashlight/Torch',
      'Magnifying glass', 'Magnet', 'Button', 'Needle', 'Paintbrush/Brush', 'Sword', 'Shield', 'Trophy', 'Medal',
      'Dice/Die', 'Diamond',
      // music and toys
      'Piano', 'Violin', 'Trumpet', 'Whistle', 'Bell', 'Swing', 'Slide', 'Seesaw', 'Doll', 'Teddy bear',
      'Yo-yo/Yoyo', 'Spinning top/Top', 'Marbles/Marble',
      // outside and getting around
      'Snowflake/Snow', 'Lightning', 'Island', 'River', 'Cave', 'Forest', 'Traffic light', 'Stop sign',
      'Helicopter', 'Ambulance', 'Tractor', 'Truck/Lorry', 'Submarine', 'Skateboard', 'Wheel', 'Steering wheel',
      'Wheelchair', 'Walking stick/Cane',
      // body
      'Foot', 'Mouth', 'Tongue', 'Lips', 'Hair', 'Mustache/Moustache', 'Beard', 'Eyebrow', 'Bone', 'Skull', 'Brain',
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
      // sports and games
      'Football/Soccer', 'Basketball', 'Volleyball', 'Tennis', 'Boxing', 'Ping pong/Table tennis', 'Wrestling',
      'Rock climbing/Climbing', 'Surfing', 'Horse riding', 'Parachute/Parachuting', 'Weightlifting', 'Chess',
      'Bowling', 'Golf', 'Card game/Cards', 'Hide and seek', 'Jump rope/Skipping rope', 'Hopscotch', 'Tug of war',
      // doing things
      'Picnic', 'Taking a photo/Photo', 'Dancing', 'Singing', 'Snoring', 'Sneezing/Sneeze', 'Yawning/Yawn',
      'Crying', 'Falling in love/Love', 'Pillow fight', 'Proposal/Marriage proposal', 'Moving house/Moving',
      'Shopping', 'Fireworks', 'Parking', 'Painting', 'Brain freeze', 'Couch potato', 'Bad hair day',
      // places
      'Park', 'Hospital', 'School', 'University', 'Airport', 'Gas station/Petrol station', 'Restaurant', 'Library',
      'Museum', 'Stadium', 'Prison/Jail', 'Circus', 'Theme park/Amusement park', 'Farm', 'Skyscraper',
      'Big Ben', 'Leaning Tower of Pisa/Tower of Pisa', 'Great Wall of China/Great Wall', 'Taj Mahal',
      'Mount Everest/Everest',
      // people and characters
      'Farmer', 'Pilot', 'Teacher', 'Painter/Artist', 'Singer', 'Actor', 'Footballer/Football player',
      'Postman/Mail carrier', 'Soldier', 'King', 'Queen', 'Princess', 'Ninja', 'Cowboy', 'Mummy', 'Genie',
      'Magic carpet', 'Snow White', 'Cinderella', 'Little Red Riding Hood/Red Riding Hood', 'Pinocchio',
      'Santa Claus/Santa', 'Werewolf', 'Frankenstein', 'Loch Ness Monster/Nessie', 'Bigfoot',
      // food and holidays
      'Hot chocolate', 'Fruit salad', 'Pancakes/Pancake', 'Birthday candles', 'Christmas tree', 'Halloween',
      'Gingerbread man', 'Fortune cookie',
      // machines, weather and space
      'Sewing machine', 'Microwave', 'Dishwasher', 'Treadmill', 'Solar eclipse/Eclipse', 'Black hole',
      'Solar system', 'UFO/Flying saucer', 'Spaceship/Spacecraft', 'Time machine', 'Thunderstorm', 'Avalanche',
      'Titanic',
    ],
  },
};
