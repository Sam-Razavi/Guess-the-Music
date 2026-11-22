// Places for the Spy game (the other Spy categories reuse the Pantomime word bank).
module.exports = {
  fa: [
    'فرودگاه', 'بیمارستان', 'ساحل', 'مدرسه', 'سینما', 'بانک', 'رستوران', 'سوپرمارکت', 'باغ وحش', 'موزه',
    'باشگاه ورزشی', 'آرایشگاه', 'جشن عروسی', 'ورزشگاه آزادی', 'کتابخانه', 'کلانتری', 'نانوایی', 'ایستگاه قطار',
    'زیردریایی', 'ایستگاه فضایی', 'کشتی دزدان دریایی', 'کویر', 'پیست اسکی', 'شهربازی', 'هتل', 'مطب دندانپزشکی',
    'بازار تهران', 'مزرعه', 'سیرک', 'تئاتر', 'استخر', 'پمپ بنزین', 'تاکسی', 'اتوبوس', 'هواپیما', 'کشتی تفریحی',
    'قلعه', 'جنگل', 'حمام عمومی', 'سفره‌خانه سنتی', 'مترو', 'ویلای شمال', 'کافه', 'آتش‌نشانی', 'دانشگاه',
  ],
  en: [
    'Airport', 'Hospital', 'Beach', 'School', 'Cinema', 'Bank', 'Restaurant', 'Supermarket', 'Zoo', 'Museum',
    'Gym', 'Hair salon', 'Wedding', 'Football stadium', 'Library', 'Police station', 'Bakery', 'Train station',
    'Submarine', 'Space station', 'Pirate ship', 'Desert camp', 'Ski resort', 'Amusement park', 'Hotel',
    'Dentist\'s office', 'Bazaar', 'Farm', 'Circus', 'Theater', 'Swimming pool', 'Gas station', 'Taxi', 'Bus',
    'Airplane', 'Cruise ship', 'Castle', 'Jungle', 'Spa', 'Café', 'Subway', 'Fire station', 'University',
    'Casino', 'Movie set',
  ],
};

// Cities (a separate Spy category). The Persian board is mostly Iranian cities.
module.exports.cities = {
  fa: [
    'تهران', 'اصفهان', 'شیراز', 'تبریز', 'مشهد', 'یزد', 'کرمان', 'رشت', 'کاشان', 'همدان', 'قزوین', 'اهواز',
    'بندرعباس', 'کیش', 'قشم', 'اردبیل', 'سنندج', 'کرمانشاه', 'زنجان', 'ساری', 'گرگان', 'بوشهر', 'ارومیه',
    'رامسر', 'چابهار', 'پاریس', 'لندن', 'دبی', 'استانبول', 'توکیو', 'نیویورک', 'رم',
  ],
  en: [
    'Paris', 'London', 'Tokyo', 'New York', 'Dubai', 'Istanbul', 'Rome', 'Sydney', 'Rio de Janeiro', 'Cairo',
    'Moscow', 'Barcelona', 'Venice', 'Amsterdam', 'Bangkok', 'Beijing', 'Los Angeles', 'Las Vegas', 'Toronto',
    'Berlin', 'Athens', 'Mumbai', 'Mexico City', 'Singapore', 'Hong Kong', 'Tehran', 'Isfahan', 'Stockholm',
    'Vienna', 'Prague',
  ],
};

// More places and cities (Nov 2026).
module.exports.fa.push(
  'زندان', 'کارخانه', 'آزمایشگاه', 'پارکینگ', 'آسانسور', 'سفارت', 'دادگاه', 'مسجد', 'کلیسا', 'گورستان',
  'باغ ایرانی', 'کاروانسرا', 'قهوه‌خانه', 'کله‌پزی', 'جگرکی', 'آب‌میوه‌فروشی', 'لوازم‌التحریری', 'داروخانه',
  'گل‌فروشی', 'خشکشویی', 'کارواش', 'تعمیرگاه ماشین', 'سالن کنسرت', 'استودیوی ضبط', 'ایستگاه رادیو',
  'استودیوی تلویزیون', 'مهدکودک', 'خوابگاه دانشجویی', 'پناهگاه کوه', 'ساحل خزر', 'مهمونی تولد',
  'سالن امتحان کنکور', 'آمبولانس', 'هلیکوپتر', 'قطار شبانه', 'آکواریوم', 'فانوس دریایی',
);
module.exports.en.push(
  'Prison', 'Factory', 'Laboratory', 'Car park', 'Lift', 'Embassy', 'Courtroom', 'Church', 'Cemetery',
  'Nightclub', 'Pharmacy', 'Flower shop', 'Car wash', 'Garage', 'Concert hall', 'Recording studio',
  'Radio station', 'TV studio', 'Kindergarten', 'Student dorm', 'Mountain hut', 'Tropical island',
  'Birthday party', 'Exam hall', 'Ambulance', 'Helicopter', 'Night train', 'Bowling alley', 'Cooking class',
  'Escape room', 'Ice rink', 'Aquarium', 'Lighthouse', 'Vineyard', 'Haunted house',
);
module.exports.cities.fa.push(
  'قم', 'نیشابور', 'شوشتر', 'آبادان', 'خرمشهر', 'ماسوله', 'انزلی', 'لاهیجان', 'بم', 'کاشمر',
  'برلین', 'آمستردام', 'استکهلم', 'سئول', 'بارسلون', 'لس‌آنجلس', 'تورنتو', 'سیدنی',
);
module.exports.cities.en.push(
  'Seoul', 'San Francisco', 'Lisbon', 'Copenhagen', 'Dublin', 'Edinburgh', 'Marrakech', 'Cape Town',
  'Buenos Aires', 'Havana', 'Kyoto', 'Shiraz', 'Budapest', 'Florence', 'Miami', 'Bali', 'Reykjavik',
);
