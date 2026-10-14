const container = document.querySelector(".container");
const btnSignIn = document.getElementById("btn-sign-in");
const btnSignUp = document.getElementById("btn-sign-up");

btnSignIn.addEventListener("click", ()=>{
    container.classList.remove("toggle");
})

btnSignUp.addEventListener("click", ()=>{
    container.classList.add("toggle");
})

document.querySelectorAll('.togglePassword').forEach(button => {
    button.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Encontrar el input dentro del mismo contenedor
        const input = this.parentElement.querySelector('input');
        const icon = this.querySelector('i');
        
        // Cambiar tipo
        const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', type);
        
        // Cambiar icono
        icon.classList.toggle('fa-eye');
        icon.classList.toggle('fa-eye-slash');
    });
});
