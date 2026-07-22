/* Requires supabase-config.js and the Supabase JS CDN script to be loaded
   before this file. Exposes a single shared client as window.db. */
(function(){
  if(typeof supabase === 'undefined'){
    console.error('Supabase JS library not loaded — check the CDN script tag in <head>.');
    return;
  }
  if(!window.SUPABASE_URL || window.SUPABASE_URL.indexOf('YOUR-PROJECT-REF') > -1){
    console.warn('Supabase URL/key not configured yet — edit shared/supabase-config.js.');
  }
  window.db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
})();
