/* =======================================================================
   Simple shared-password gate for the Admin Upload tab.

   IMPORTANT — be clear-eyed about what this is and isn't:
   This is a UI convenience, not real security. The password check happens
   in the browser, and the Supabase anon key (in supabase-config.js) still
   grants full read/write to anyone who opens the browser's dev tools and
   calls the API directly, password or not — RLS on the tables currently
   allows the anon role to do anything (see sql/schema.sql). This gate just
   stops a teammate from casually clicking into Admin and uploading the
   wrong file; it does not stop a determined or malicious actor.

   If you want real protection later, the fix is Supabase Auth (email/
   password login) plus RLS policies that require the 'authenticated' role
   for writes — a bigger change, happy to build it when you're ready.
   ======================================================================= */
window.ADMIN_PASSWORD = 'changeme';

window.AdminAuth = {
  isUnlocked: function(){
    return sessionStorage.getItem('flow_admin_unlocked') === '1';
  },
  unlock: function(password){
    if(password === window.ADMIN_PASSWORD){
      sessionStorage.setItem('flow_admin_unlocked', '1');
      return true;
    }
    return false;
  },
  lock: function(){
    sessionStorage.removeItem('flow_admin_unlocked');
  }
};
